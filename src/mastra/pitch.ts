/**
 * The sponsored voice-over ("the pitch"): a viewer with enough karma gets the channel's voice to
 * advertise something of theirs over whatever is on air.
 *
 * `PitchSlot` is the fairness and cost rules — one pitch at a time, a per-user cooldown, and a
 * deadline after which an uncollected pitch is dropped. Pure and synchronous with the clock
 * injected, like `Channel` and `SpendLedger`. `submitPitch()` is the paid half (moderation, the ad
 * read, TTS) with every call injected, so those rules stay testable without a network.
 *
 * ponytail: in-memory only, like the rest of the channel's state.
 */
import { clip, synthesise } from "./announcer";
import { channel } from "./channel";
import type { ModerationOutcome, SpokenLineOutcome } from "./showrunner";
import { moderatePitch, writeAdRead } from "./showrunner";
import type { TokenUsage } from "./spend";
import { spend } from "./spend";

/** Likes needed before a viewer can instruct the voice. Three scenes' worth of other people. */
export const PITCH_MIN_KARMA = 3;
export const PITCH_COOLDOWN_MS = 180_000;

/** How long a pitch waits for the broadcaster to collect and play it before it is dropped. */
export const PITCH_SLOT_TIMEOUT_MS = 60_000;

/** A dropped pitch stays on /status this long, so a viewer watching sees it never aired. */
const DROPPED_VISIBLE_MS = 8_000;

export type PitchState = "writing" | "pending" | "playing" | "dropped";

export interface Pitch {
  id: number;
  uid: string;
  name: string;
  brief: string;
  state: PitchState;
  /** Where the broadcaster fetches the ad read. Set once SLNG has synthesised it. */
  url: string | undefined;
  /** When the pitch entered its current state: what the slot deadline is measured from. */
  at: number;
}

/** What `/status` carries so viewers know whose ad they are hearing. */
export interface PitchStatus {
  name: string;
  brief: string;
  state: PitchState;
}

export type PitchRefusal = "karma" | "cooldown" | "busy" | "rejected" | "unavailable";

export type PitchResult =
  | { ok: true; line: string }
  | { ok: false; code: PitchRefusal; reason: string };

type Reservation = { ok: true; pitch: Pitch } | { ok: false; code: PitchRefusal; reason: string };

export class PitchSlot {
  private current: Pitch | undefined;
  private nextId = 1;
  private reservedAt = new Map<string, number>();
  private dropped: Pitch[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Whole seconds until this user may pitch again; 0 when they may pitch now. */
  cooldownSeconds(uid: string): number {
    const last = this.reservedAt.get(uid);
    if (last === undefined) return 0;
    const left = PITCH_COOLDOWN_MS - (this.now() - last);
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /**
   * Claim the slot before any paid work happens. The cooldown starts here rather than on success,
   * so a viewer cannot burn LLM and TTS calls by retrying a pitch that keeps being turned down.
   */
  reserve(input: { uid: string; name: string; brief: string; karma: number }): Reservation {
    this.sweep();
    if (input.karma < PITCH_MIN_KARMA) {
      const short = PITCH_MIN_KARMA - input.karma;
      return {
        ok: false,
        code: "karma",
        reason:
          `The pitch needs ${PITCH_MIN_KARMA} karma. You have ${input.karma}, ${short} to go.`,
      };
    }
    const cooldown = this.cooldownSeconds(input.uid);
    if (cooldown > 0) {
      const reason = `One pitch every 3 minutes: ${cooldown}s left.`;
      return { ok: false, code: "cooldown", reason };
    }
    if (this.current && this.current.state !== "dropped") {
      return {
        ok: false,
        code: "busy",
        reason: `${this.current.name} has the pitch slot right now. Try again in a minute.`,
      };
    }
    const pitch: Pitch = {
      id: this.nextId++,
      uid: input.uid,
      name: input.name,
      brief: input.brief,
      state: "writing",
      url: undefined,
      at: this.now(),
    };
    this.current = pitch;
    this.reservedAt.set(input.uid, this.now());
    return { ok: true, pitch };
  }

  /**
   * The ad read is synthesised, so the broadcaster may collect it and the slot deadline starts.
   * False when the pitch is already gone — it took so long to write that the slot timed out.
   */
  ready(id: number, url: string): boolean {
    if (this.current?.id !== id || this.current.state !== "writing") return false;
    this.current.url = url;
    this.current.state = "pending";
    this.current.at = this.now();
    return true;
  }

  /** Writing or synthesis failed on our side: free the slot AND the cooldown, nothing was aired. */
  abandon(id: number): void {
    if (this.current?.id !== id) return;
    this.reservedAt.delete(this.current.uid);
    this.current = undefined;
  }

  /** Free the slot but keep the cooldown: the pitch had its turn, or its brief was turned down. */
  release(id: number): void {
    if (this.current?.id === id) this.current = undefined;
  }

  /** Hand the waiting pitch to the broadcaster exactly once. */
  take(): Pitch | undefined {
    this.sweep();
    const pitch = this.current;
    if (!pitch || pitch.state !== "pending" || pitch.url === undefined) return undefined;
    pitch.state = "playing";
    pitch.at = this.now();
    return { ...pitch };
  }

  /** Drop a pitch nobody collected in time, and forget a dropped one once it has been seen. */
  sweep(): void {
    const pitch = this.current;
    if (!pitch) return;
    const age = this.now() - pitch.at;
    if (pitch.state === "dropped") {
      if (age >= DROPPED_VISIBLE_MS) this.current = undefined;
      return;
    }
    if (age < PITCH_SLOT_TIMEOUT_MS) return;
    pitch.state = "dropped";
    pitch.at = this.now();
    this.dropped.push({ ...pitch });
  }

  /** A pitch dropped since the last call, so the caller can tell whoever submitted it. */
  takeDropped(): Pitch | undefined {
    return this.dropped.shift();
  }

  status(): PitchStatus | undefined {
    this.sweep();
    const pitch = this.current;
    // "writing" is a few invisible seconds of LLM and TTS: there is nothing to show yet.
    if (!pitch || pitch.state === "writing") return undefined;
    return { name: pitch.name, brief: pitch.brief, state: pitch.state };
  }
}

export interface PitchDeps {
  karmaOf: (uid: string) => number;
  moderate: (brief: string, name: string) => Promise<ModerationOutcome>;
  writeAdRead: (name: string, brief: string) => Promise<SpokenLineOutcome>;
  synthesise: (clipId: string, line: string) => Promise<string>;
  clipBytes: (clipId: string) => number;
  recordTokens: (usage: TokenUsage) => void;
  recordTts: (audioBytes: number) => void;
}

/**
 * Gate, moderate, write and synthesise one pitch. The slot is claimed first so two viewers cannot
 * both pay for an ad read neither of them gets, and freed again on every path that fails.
 */
export async function submitPitch(
  slot: PitchSlot,
  deps: PitchDeps,
  input: { uid: string; name: string; brief: string },
): Promise<PitchResult> {
  const reserved = slot.reserve({ ...input, karma: deps.karmaOf(input.uid) });
  if (!reserved.ok) return reserved;
  const { id } = reserved.pitch;
  try {
    const { verdict, usage } = await deps.moderate(input.brief, input.name);
    deps.recordTokens(usage);
    if (!verdict.ok) {
      slot.release(id);
      return { ok: false, code: "rejected", reason: verdict.reason };
    }
    const ad = await deps.writeAdRead(input.name, input.brief);
    deps.recordTokens(ad.usage);
    const clipId = await deps.synthesise(`pitch-${id}`, ad.line);
    deps.recordTts(deps.clipBytes(clipId));
    // Page-relative, so it still resolves when the app is served under a path prefix.
    if (!slot.ready(id, `announcer/${clipId}`)) {
      return { ok: false, code: "unavailable", reason: "That took too long to write. Try again." };
    }
    return { ok: true, line: ad.line };
  } catch (error) {
    slot.abandon(id);
    console.error(`pitch ${id} from ${input.uid} failed, slot freed:`, error);
    return { ok: false, code: "unavailable", reason: "The voice is busy right now. Try again." };
  }
}

/** The one shared slot for this process. index.ts and telegram.ts both use it. */
export const pitchSlot = new PitchSlot();

/** The live wiring of submitPitch's paid half: Nebius moderation and ad read, SLNG clip, ledger. */
export const livePitchDeps: PitchDeps = {
  karmaOf: (uid) => channel.karmaOf(uid),
  moderate: moderatePitch,
  writeAdRead,
  synthesise,
  clipBytes: (clipId) => clip(clipId)?.length ?? 0,
  recordTokens: (usage) => spend.recordPitchTokens(usage),
  recordTts: (audioBytes) => spend.recordPitchTts(audioBytes),
};
