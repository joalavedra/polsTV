/**
 * Cost estimate ledger for the channel's four paid providers: fal Director, Nebius, SLNG, Vonage.
 * Pure and synchronous — no I/O, no clock inside; callers (index.ts) supply already-measured
 * quantities (tokens, bytes, elapsed ms). Every dollar figure here is an ESTIMATE computed from the
 * rates below, not a real invoice — see docs/CONTRACT.md's `/spend` section.
 *
 * ponytail: in-memory only, resets on restart along with the rest of the channel's state
 * (channel.ts and announcer.ts's clips carry the same note).
 */

// fal Director. List price is $0.08/s, but the account dashboard shows $7.56 billed for today's
// sessions, which reconciles to $0.02/s — that is what we are actually charged, so that is the
// rate used here, not the list price. See PLAN.md §0 and docs/cards/director.md.
export const FAL_DIRECTOR_USD_PER_SECOND = 0.02;

// Nebius Qwen/Qwen3-30B-A3B-Instruct-2507 router price. docs/cards/mastra-nebius.md §3.
export const NEBIUS_INPUT_USD_PER_MILLION_TOKENS = 0.1;
export const NEBIUS_OUTPUT_USD_PER_MILLION_TOKENS = 0.3;

// SLNG slng/fish/tts:s2.1-pro. docs/cards/slng.md §7 (`GET /v1/catalog/models?service_type=tts`).
// The card flags this unit as unconfirmed against what eu-west actually bills — estimate it is.
export const SLNG_MICRODOLLARS_PER_AUDIO_MINUTE = 110;

// SLNG mp3s come back 128 kbps CBR: 128_000 bits/s / 8 bits/byte.
export const SLNG_MP3_BYTES_PER_SECOND = 16_000;

// Vonage Video. docs/cards/vonage.md §7. New accounts get 75,000 free participant-minutes, which
// covers this project today, but the meter still runs so judges can see the real rate.
export const VONAGE_USD_PER_PARTICIPANT_MINUTE = 0.0041;

// A stalled broadcaster tab must not invent spend between polls it missed.
const MAX_HEARTBEAT_GAP_SECONDS = 10;

const SCENES_KEPT = 8;

export const RATES = {
  fal: {
    usd: FAL_DIRECTOR_USD_PER_SECOND,
    unit: "per second of open Director session",
    note: "billed rate reconciled from the account dashboard, not fal's $0.08/s list price",
  },
  nebius: {
    inputUsdPerMillionTokens: NEBIUS_INPUT_USD_PER_MILLION_TOKENS,
    outputUsdPerMillionTokens: NEBIUS_OUTPUT_USD_PER_MILLION_TOKENS,
    model: "Qwen/Qwen3-30B-A3B-Instruct-2507",
  },
  slng: {
    microdollarsPerAudioMinute: SLNG_MICRODOLLARS_PER_AUDIO_MINUTE,
    model: "slng/fish/tts:s2.1-pro",
    note: "unit unconfirmed by SLNG's own docs; treat as an estimate",
  },
  vonage: {
    usd: VONAGE_USD_PER_PARTICIPANT_MINUTE,
    unit: "per participant-minute",
    note: "covered today by Vonage's 75,000 free participant-minute tier",
  },
} as const;

export type Provider = "fal" | "nebius" | "slng" | "vonage";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

type ProviderUsd = Record<Provider, number>;

export interface SceneSpend {
  ideaId: number;
  name: string;
  text: string;
  usd: number;
  byProvider: ProviderUsd;
}

export interface SpendSnapshot {
  totalUsd: number;
  rates: typeof RATES;
  byProvider: {
    fal: { usd: number; seconds: number };
    nebius: { usd: number; inputTokens: number; outputTokens: number; calls: number };
    slng: { usd: number; audioSeconds: number; calls: number };
    vonage: { usd: number; participantMinutes: number };
  };
  scenes: SceneSpend[];
  notAired: { usd: number };
  idle: { usd: number };
  /** Sponsored voice-overs (pitch.ts). They play over whatever is on air, so they have no scene. */
  pitches: { usd: number };
  /** Nebius cost of ticker photo/caption moderation — never tied to a scene (see recordTicker) */
  ticker: { usd: number };
}

function nebiusCost(usage: TokenUsage): number {
  return (
    (usage.inputTokens / 1_000_000) * NEBIUS_INPUT_USD_PER_MILLION_TOKENS +
    (usage.outputTokens / 1_000_000) * NEBIUS_OUTPUT_USD_PER_MILLION_TOKENS
  );
}

function slngCost(audioSeconds: number): number {
  return (audioSeconds / 60) * (SLNG_MICRODOLLARS_PER_AUDIO_MINUTE / 1_000_000);
}

function zeroProviderUsd(): ProviderUsd {
  return { fal: 0, nebius: 0, slng: 0, vonage: 0 };
}

interface PendingIdea {
  name: string;
  text: string;
  usd: number;
  byProvider: ProviderUsd;
}

/**
 * The channel's cost ledger. An idea's moderation, steer-writing and TTS cost is charged to the
 * `notAired` catch-all the instant it happens (pessimistic default); if the idea goes on to air,
 * `markAired` moves that cost out of `notAired` and into its scene. fal and Vonage time is charged
 * directly to whichever scene is on air, or to `idle` when nothing is. A sponsored voice-over has
 * no scene of its own, so its cost goes to `pitches`. See spend.test.ts for the accounting
 * invariants (every dollar lands in exactly one of: a scene, notAired, idle, pitches, ticker).
 */
export class SpendLedger {
  private fal = { usd: 0, seconds: 0 };
  private nebius = { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
  private slng = { usd: 0, audioSeconds: 0, calls: 0 };
  private vonage = { usd: 0, participantMinutes: 0 };
  private notAiredUsd = 0;
  private idleUsd = 0;
  private pitchesUsd = 0;
  private tickerUsd = 0;
  private scenes: SceneSpend[] = [];
  private pending = new Map<number, PendingIdea>();

  /**
   * Charge one moderation call. `target` is the idea's id once it has a queue slot, or "rejected"
   * if it never got one (moderation failed it, or the queue turned it down as a duplicate).
   */
  recordModeration(
    target: number | "rejected",
    name: string,
    text: string,
    usage: TokenUsage,
  ): void {
    const usd = this.chargeNebius(usage);
    this.notAiredUsd += usd;
    if (target !== "rejected") this.chargePending(target, name, text, "nebius", usd);
  }

  /**
   * Charge one Nebius writing call — the steering prompt, or the narrator line read over it — to
   * an idea already picked to steer next.
   */
  recordSteerWrite(ideaId: number, name: string, text: string, usage: TokenUsage): void {
    const usd = this.chargeNebius(usage);
    this.notAiredUsd += usd;
    this.chargePending(ideaId, name, text, "nebius", usd);
  }

  /** Charge one SLNG TTS clip. `audioBytes` is the mp3 byte length SLNG returned. */
  recordTts(ideaId: number, name: string, text: string, audioBytes: number): void {
    const usd = this.chargeSlng(audioBytes);
    this.notAiredUsd += usd;
    this.chargePending(ideaId, name, text, "slng", usd);
  }

  /** Charge one Nebius call for a sponsored voice-over: its moderation, or writing its ad read. */
  recordPitchTokens(usage: TokenUsage): void {
    this.pitchesUsd += this.chargeNebius(usage);
  }

  /** Charge one SLNG clip for a sponsored voice-over. */
  recordPitchTts(audioBytes: number): void {
    this.pitchesUsd += this.chargeSlng(audioBytes);
  }

  /**
   * Charge one ticker Nebius call (image moderation or caption/name moderation). Ticker
   * submissions are never tied to a queued idea, so this scene-less line — not `notAired`, which
   * is idea-specific — is where all of it lands, whatever the verdict.
   */
  recordTicker(usage: TokenUsage): void {
    const usd = this.chargeNebius(usage);
    this.tickerUsd += usd;
  }

  /** Charge fal Director open-session seconds to the scene on air, or "idle" when none is. */
  recordFal(target: number | "idle", seconds: number): void {
    const usd = seconds * FAL_DIRECTOR_USD_PER_SECOND;
    this.fal.usd += usd;
    this.fal.seconds += seconds;
    this.chargeSceneOrIdle(target, "fal", usd);
  }

  /** Charge Vonage participant-minutes to the scene on air, or "idle" when none is. */
  recordVonage(target: number | "idle", participantMinutes: number): void {
    const usd = participantMinutes * VONAGE_USD_PER_PARTICIPANT_MINUTE;
    this.vonage.usd += usd;
    this.vonage.participantMinutes += participantMinutes;
    this.chargeSceneOrIdle(target, "vonage", usd);
  }

  /**
   * One broadcaster heartbeat (its `next-steer` poll): `elapsedMs` since the previous one, capped
   * so a stalled tab can't invent spend; `directorOpen` gates fal billing; `target`/`participants`
   * say who Vonage is charging for right now. Vonage always accrues; fal only while Director is
   * open.
   */
  accrueHeartbeat(input: {
    elapsedMs: number;
    directorOpen: boolean;
    target: number | "idle";
    participants: number;
  }): void {
    const cappedMs = Math.min(Math.max(input.elapsedMs, 0), MAX_HEARTBEAT_GAP_SECONDS * 1000);
    const seconds = cappedMs / 1000;
    if (input.directorOpen) this.recordFal(input.target, seconds);
    this.recordVonage(input.target, (input.participants * seconds) / 60);
  }

  /** An idea's steer was applied: move its accrued cost out of `notAired` and into a new scene. */
  markAired(ideaId: number, name: string, text: string): void {
    const entry = this.pending.get(ideaId);
    this.pending.delete(ideaId);
    const usd = entry?.usd ?? 0;
    this.notAiredUsd -= usd;
    this.scenes.unshift({
      ideaId,
      name: entry?.name ?? name,
      text: entry?.text ?? text,
      usd,
      byProvider: entry?.byProvider ?? zeroProviderUsd(),
    });
    this.scenes.length = Math.min(this.scenes.length, SCENES_KEPT);
  }

  /** An idea's steer was rejected (or dropped without airing): its cost stays in `notAired`. */
  markNotAired(ideaId: number): void {
    this.pending.delete(ideaId);
  }

  snapshot(): SpendSnapshot {
    return {
      totalUsd: this.fal.usd + this.nebius.usd + this.slng.usd + this.vonage.usd,
      rates: RATES,
      byProvider: {
        fal: { ...this.fal },
        nebius: { ...this.nebius },
        slng: { ...this.slng },
        vonage: { ...this.vonage },
      },
      scenes: this.scenes.map((scene) => ({ ...scene, byProvider: { ...scene.byProvider } })),
      notAired: { usd: this.notAiredUsd },
      idle: { usd: this.idleUsd },
      pitches: { usd: this.pitchesUsd },
      ticker: { usd: this.tickerUsd },
    };
  }

  private chargeSlng(audioBytes: number): number {
    const audioSeconds = audioBytes / SLNG_MP3_BYTES_PER_SECOND;
    const usd = slngCost(audioSeconds);
    this.slng.usd += usd;
    this.slng.audioSeconds += audioSeconds;
    this.slng.calls += 1;
    return usd;
  }

  private chargeNebius(usage: TokenUsage): number {
    const usd = nebiusCost(usage);
    this.nebius.usd += usd;
    this.nebius.inputTokens += usage.inputTokens;
    this.nebius.outputTokens += usage.outputTokens;
    this.nebius.calls += 1;
    return usd;
  }

  private chargePending(
    ideaId: number,
    name: string,
    text: string,
    provider: Provider,
    usd: number,
  ): void {
    const entry = this.pending.get(ideaId) ?? { name, text, usd: 0, byProvider: zeroProviderUsd() };
    entry.usd += usd;
    entry.byProvider[provider] += usd;
    this.pending.set(ideaId, entry);
  }

  private chargeSceneOrIdle(target: number | "idle", provider: Provider, usd: number): void {
    const scene = target === "idle" ? undefined : this.scenes.find((s) => s.ideaId === target);
    if (!scene) {
      this.idleUsd += usd;
      return;
    }
    scene.usd += usd;
    scene.byProvider[provider] += usd;
  }
}

/** The one shared ledger instance for this process. index.ts and telegram.ts both import it. */
export const spend = new SpendLedger();
