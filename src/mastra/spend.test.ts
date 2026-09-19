import { describe, expect, it } from "vitest";
import {
  FAL_DIRECTOR_USD_PER_SECOND,
  NEBIUS_INPUT_USD_PER_MILLION_TOKENS,
  NEBIUS_OUTPUT_USD_PER_MILLION_TOKENS,
  SLNG_MICRODOLLARS_PER_AUDIO_MINUTE,
  SLNG_MP3_BYTES_PER_SECOND,
  SLNG_STT_MICRODOLLARS_PER_AUDIO_MINUTE,
  SpendLedger,
  VONAGE_USD_PER_PARTICIPANT_MINUTE,
} from "./spend";

function totalOf(ledger: SpendLedger): number {
  return ledger.snapshot().totalUsd;
}

/** Every dollar recorded has to land in exactly one bucket: a scene, notAired, idle or pitches. */
function bucketedTotal(ledger: SpendLedger): number {
  const snap = ledger.snapshot();
  const scenes = snap.scenes.reduce((sum, scene) => sum + scene.usd, 0);
  return scenes + snap.notAired.usd + snap.idle.usd + snap.pitches.usd;
}

describe("rate maths", () => {
  it("prices a moderation call from input/output tokens", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(1, "Ana", "a cat", { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const { nebius } = ledger.snapshot().byProvider;
    const expectedUsd = NEBIUS_INPUT_USD_PER_MILLION_TOKENS + NEBIUS_OUTPUT_USD_PER_MILLION_TOKENS;
    expect(nebius.usd).toBeCloseTo(expectedUsd, 9);
    expect(nebius.inputTokens).toBe(1_000_000);
    expect(nebius.outputTokens).toBe(1_000_000);
    expect(nebius.calls).toBe(1);
  });

  it("prices a TTS clip from mp3 byte length at 128 kbps CBR", () => {
    const ledger = new SpendLedger();
    ledger.recordTts(1, "Ana", "a cat", SLNG_MP3_BYTES_PER_SECOND * 60); // exactly 1 minute
    const { slng } = ledger.snapshot().byProvider;
    expect(slng.audioSeconds).toBeCloseTo(60, 9);
    expect(slng.usd).toBeCloseTo(SLNG_MICRODOLLARS_PER_AUDIO_MINUTE / 1_000_000, 9);
    expect(slng.calls).toBe(1);
  });

  it("prices an STT call from audio seconds at the STT rate, pooled into the slng bucket", () => {
    const ledger = new SpendLedger();
    ledger.recordStt("rejected", "Ana", "a cat", 30);
    const { slng } = ledger.snapshot().byProvider;
    expect(slng.audioSeconds).toBeCloseTo(30, 9);
    const expectedUsd = (30 / 60) * (SLNG_STT_MICRODOLLARS_PER_AUDIO_MINUTE / 1_000_000);
    expect(slng.usd).toBeCloseTo(expectedUsd, 9);
    expect(slng.calls).toBe(1);
  });

  it("prices fal seconds and Vonage participant-minutes at their published rates", () => {
    const ledger = new SpendLedger();
    ledger.recordFal("idle", 10);
    ledger.recordVonage("idle", 5);
    const snap = ledger.snapshot();
    expect(snap.byProvider.fal.usd).toBeCloseTo(10 * FAL_DIRECTOR_USD_PER_SECOND, 9);
    expect(snap.byProvider.fal.seconds).toBe(10);
    expect(snap.byProvider.vonage.usd).toBeCloseTo(5 * VONAGE_USD_PER_PARTICIPANT_MINUTE, 9);
    expect(snap.byProvider.vonage.participantMinutes).toBe(5);
  });

  it("totalUsd is exactly the sum of the four provider totals", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(1, "Ana", "a cat", { inputTokens: 500, outputTokens: 200 });
    ledger.markAired(1, "Ana", "a cat");
    ledger.recordFal(1, 3);
    ledger.recordVonage(1, 2);
    ledger.recordTts(1, "Ana", "a cat", 4000);
    const snap = ledger.snapshot();
    const sum = snap.byProvider.fal.usd + snap.byProvider.nebius.usd + snap.byProvider.slng.usd +
      snap.byProvider.vonage.usd;
    expect(snap.totalUsd).toBeCloseTo(sum, 9);
  });
});

describe("sponsored voice-overs", () => {
  it("charges a pitch's Nebius calls and clip to the scene-less pitches line", () => {
    const ledger = new SpendLedger();
    ledger.recordPitchTokens({ inputTokens: 1_000_000, outputTokens: 0 });
    ledger.recordPitchTts(SLNG_MP3_BYTES_PER_SECOND * 60);
    const snap = ledger.snapshot();
    const expectedUsd = NEBIUS_INPUT_USD_PER_MILLION_TOKENS +
      SLNG_MICRODOLLARS_PER_AUDIO_MINUTE / 1_000_000;
    expect(snap.pitches.usd).toBeCloseTo(expectedUsd, 9);
    expect(snap.notAired.usd).toBe(0);
    expect(snap.scenes).toHaveLength(0);
    expect(snap.byProvider.slng.calls).toBe(1);
    expect(snap.byProvider.nebius.calls).toBe(1);
  });

  it("keeps the buckets adding up to the total once pitches and scenes are mixed", () => {
    const ledger = new SpendLedger();
    const usage = { inputTokens: 300, outputTokens: 120 };
    ledger.recordModeration(1, "Ana", "a cat", usage);
    ledger.recordSteerWrite(1, "Ana", "a cat", usage);
    ledger.recordTts(1, "Ana", "a cat", 20_000);
    ledger.markAired(1, "Ana", "a cat");
    ledger.recordFal(1, 4);
    ledger.recordVonage(1, 3);
    ledger.recordModeration("rejected", "Bob", "a celebrity", usage);
    ledger.recordFal("idle", 2);
    ledger.recordPitchTokens(usage);
    ledger.recordPitchTts(12_000);
    const snap = ledger.snapshot();
    expect(snap.pitches.usd).toBeGreaterThan(0);
    expect(bucketedTotal(ledger)).toBeCloseTo(snap.totalUsd, 9);
  });
});

describe("heartbeat gap cap", () => {
  it("caps a single elapsed gap at 10 seconds so a stalled tab cannot invent spend", () => {
    const ledger = new SpendLedger();
    ledger.accrueHeartbeat({
      elapsedMs: 60 * 60_000,
      directorOpen: true,
      target: "idle",
      participants: 1,
    });
    const snap = ledger.snapshot();
    expect(snap.byProvider.fal.seconds).toBe(10);
    expect(snap.byProvider.fal.usd).toBeCloseTo(10 * FAL_DIRECTOR_USD_PER_SECOND, 9);
  });

  it("never accrues negative spend for a negative or zero gap", () => {
    const ledger = new SpendLedger();
    ledger.accrueHeartbeat({
      elapsedMs: -500,
      directorOpen: true,
      target: "idle",
      participants: 1,
    });
    expect(ledger.snapshot().byProvider.fal.seconds).toBe(0);
  });

  it("skips fal but still accrues Vonage when Director is not open", () => {
    const ledger = new SpendLedger();
    ledger.accrueHeartbeat({
      elapsedMs: 3000,
      directorOpen: false,
      target: "idle",
      participants: 2,
    });
    const snap = ledger.snapshot();
    expect(snap.byProvider.fal.seconds).toBe(0);
    expect(snap.byProvider.vonage.participantMinutes).toBeCloseTo((2 * 3) / 60, 9);
  });
});

describe("attribution", () => {
  it("moves moderation, steer-write and TTS cost into the scene once it airs", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(7, "Timba", "a clay capybara", { inputTokens: 100, outputTokens: 50 });
    ledger.recordSteerWrite(7, "Timba", "a clay capybara", { inputTokens: 80, outputTokens: 60 });
    ledger.recordTts(7, "Timba", "a clay capybara", 16_000);
    expect(ledger.snapshot().notAired.usd).toBeGreaterThan(0);
    expect(ledger.snapshot().scenes).toHaveLength(0);

    ledger.markAired(7, "Timba", "a clay capybara");
    const snap = ledger.snapshot();
    expect(snap.notAired.usd).toBeCloseTo(0, 9);
    expect(snap.scenes).toHaveLength(1);
    const scene = snap.scenes[0];
    expect(scene?.ideaId).toBe(7);
    expect(scene?.byProvider.nebius).toBeGreaterThan(0);
    expect(scene?.byProvider.slng).toBeGreaterThan(0);
    expect(scene?.usd).toBeCloseTo(
      (scene?.byProvider.nebius ?? 0) + (scene?.byProvider.slng ?? 0),
      9,
    );
  });

  it("keeps charging fal/Vonage to the scene while it stays on air", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(1, "Ana", "a cat", { inputTokens: 0, outputTokens: 0 });
    ledger.markAired(1, "Ana", "a cat");
    ledger.recordFal(1, 5);
    ledger.recordVonage(1, 2);
    const scene = ledger.snapshot().scenes[0];
    expect(scene?.byProvider.fal).toBeCloseTo(5 * FAL_DIRECTOR_USD_PER_SECOND, 9);
    expect(scene?.byProvider.vonage).toBeCloseTo(2 * VONAGE_USD_PER_PARTICIPANT_MINUTE, 9);
  });

  it("attributes fal/Vonage time to idle once a different scene (or none) is on air", () => {
    const ledger = new SpendLedger();
    ledger.recordFal("idle", 4);
    ledger.recordVonage("idle", 1);
    const snap = ledger.snapshot();
    const expectedIdleUsd = 4 * FAL_DIRECTOR_USD_PER_SECOND + 1 * VONAGE_USD_PER_PARTICIPANT_MINUTE;
    expect(snap.idle.usd).toBeCloseTo(expectedIdleUsd, 9);
    expect(snap.scenes).toHaveLength(0);
  });
});

describe("STT attribution", () => {
  it("moves STT cost into the scene once the idea it transcribed airs", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(5, "Timba", "a clay capybara", { inputTokens: 10, outputTokens: 5 });
    ledger.recordStt(5, "Timba", "a clay capybara", 3);
    expect(ledger.snapshot().notAired.usd).toBeGreaterThan(0);
    ledger.markAired(5, "Timba", "a clay capybara");
    const scene = ledger.snapshot().scenes[0];
    expect(scene?.byProvider.slng).toBeGreaterThan(0);
  });

  it("keeps a refused idea's STT cost in notAired forever, same as its moderation cost", () => {
    const ledger = new SpendLedger();
    ledger.recordStt("rejected", "Ana", "gibberish", 4);
    const snap = ledger.snapshot();
    expect(snap.notAired.usd).toBeGreaterThan(0);
    expect(snap.notAired.usd).toBeCloseTo(totalOf(ledger), 9);
    expect(snap.scenes).toHaveLength(0);
  });
});

describe("not-aired bucket", () => {
  it("keeps a rejected idea's moderation cost in notAired forever", () => {
    const ledger = new SpendLedger();
    const usage = { inputTokens: 40, outputTokens: 10 };
    ledger.recordModeration("rejected", "Ana", "a real celebrity", usage);
    const snap = ledger.snapshot();
    expect(snap.notAired.usd).toBeGreaterThan(0);
    expect(snap.notAired.usd).toBeCloseTo(totalOf(ledger), 9);
    expect(snap.scenes).toHaveLength(0);
  });

  it("keeps a Director-rejected idea's cost in notAired via markNotAired", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(3, "Bob", "a dog", { inputTokens: 40, outputTokens: 10 });
    ledger.recordSteerWrite(3, "Bob", "a dog", { inputTokens: 20, outputTokens: 20 });
    const beforeNotAired = ledger.snapshot().notAired.usd;
    ledger.markNotAired(3);
    const snap = ledger.snapshot();
    expect(snap.notAired.usd).toBeCloseTo(beforeNotAired, 9);
    expect(snap.scenes).toHaveLength(0);
    expect(snap.notAired.usd).toBeCloseTo(totalOf(ledger), 9);
  });
});

describe("last-8 ordering", () => {
  it("keeps only the 8 most recently aired scenes, newest first", () => {
    const ledger = new SpendLedger();
    const usage = { inputTokens: 1, outputTokens: 1 };
    for (let ideaId = 1; ideaId <= 9; ideaId += 1) {
      ledger.recordModeration(ideaId, `viewer${ideaId}`, `idea ${ideaId}`, usage);
      ledger.markAired(ideaId, `viewer${ideaId}`, `idea ${ideaId}`);
    }
    const { scenes } = ledger.snapshot();
    expect(scenes).toHaveLength(8);
    expect(scenes.map((s) => s.ideaId)).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
  });
});

describe("ticker bucket", () => {
  it("charges a ticker moderation call to Nebius and the ticker scene-less line", () => {
    const ledger = new SpendLedger();
    ledger.recordTicker({ inputTokens: 1000, outputTokens: 500 });
    const snap = ledger.snapshot();
    expect(snap.ticker.usd).toBeGreaterThan(0);
    expect(snap.byProvider.nebius.usd).toBeCloseTo(snap.ticker.usd, 9);
    expect(snap.totalUsd).toBeCloseTo(snap.byProvider.nebius.usd, 9);
  });

  it("never moves ticker cost into a scene, even once one airs", () => {
    const ledger = new SpendLedger();
    ledger.recordTicker({ inputTokens: 100, outputTokens: 50 });
    ledger.recordModeration(1, "Ana", "a cat", { inputTokens: 10, outputTokens: 10 });
    ledger.markAired(1, "Ana", "a cat");
    const snap = ledger.snapshot();
    expect(snap.ticker.usd).toBeGreaterThan(0);
    expect(snap.scenes[0]?.byProvider.nebius).toBeCloseTo(
      snap.byProvider.nebius.usd - snap.ticker.usd,
      9,
    );
  });

  it("keeps scene-less lines plus scenes summing to totalUsd", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(1, "Ana", "a cat", { inputTokens: 100, outputTokens: 50 });
    ledger.markAired(1, "Ana", "a cat");
    ledger.recordFal(1, 2);
    ledger.recordTicker({ inputTokens: 200, outputTokens: 100 });
    ledger.recordVonage("idle", 1);
    const snap = ledger.snapshot();
    const scenesUsd = snap.scenes.reduce((sum, scene) => sum + scene.usd, 0);
    expect(scenesUsd + snap.notAired.usd + snap.idle.usd + snap.ticker.usd).toBeCloseTo(
      snap.totalUsd,
      9,
    );
  });
});

describe("concierge bucket", () => {
  it("charges the concierge's STT, LLM and TTS to the scene-less concierge line", () => {
    const ledger = new SpendLedger();
    ledger.recordConciergeStt(30);
    ledger.recordConciergeTokens({ inputTokens: 1_000_000, outputTokens: 0 });
    ledger.recordConciergeTts(SLNG_MP3_BYTES_PER_SECOND * 60);
    const snap = ledger.snapshot();
    const expectedUsd =
      (30 / 60) * (SLNG_STT_MICRODOLLARS_PER_AUDIO_MINUTE / 1_000_000) +
      NEBIUS_INPUT_USD_PER_MILLION_TOKENS +
      SLNG_MICRODOLLARS_PER_AUDIO_MINUTE / 1_000_000;
    expect(snap.concierge.usd).toBeCloseTo(expectedUsd, 9);
    expect(snap.notAired.usd).toBe(0);
    expect(snap.scenes).toHaveLength(0);
  });

  it("keeps scene-less lines plus scenes summing to totalUsd once mixed with an aired scene", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(1, "Ana", "a cat", { inputTokens: 100, outputTokens: 50 });
    ledger.markAired(1, "Ana", "a cat");
    ledger.recordFal(1, 2);
    ledger.recordConciergeTokens({ inputTokens: 200, outputTokens: 100 });
    const snap = ledger.snapshot();
    const scenesUsd = snap.scenes.reduce((sum, scene) => sum + scene.usd, 0);
    expect(scenesUsd + snap.notAired.usd + snap.idle.usd + snap.concierge.usd).toBeCloseTo(
      snap.totalUsd,
      9,
    );
  });
});

describe("recordSceneTokens (recs.ts's post-hoc scene write)", () => {
  it("attributes into the scene when it is still in the kept window", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration(7, "Ana", "a cat", { inputTokens: 0, outputTokens: 0 });
    ledger.markAired(7, "Ana", "a cat");
    ledger.recordSceneTokens(7, { inputTokens: 1_000_000, outputTokens: 0 });
    const scene = ledger.snapshot().scenes[0];
    expect(scene?.byProvider.nebius).toBeCloseTo(NEBIUS_INPUT_USD_PER_MILLION_TOKENS, 9);
    expect(scene?.usd).toBeCloseTo(NEBIUS_INPUT_USD_PER_MILLION_TOKENS, 9);
  });

  it("falls back to idle once the scene has scrolled out of the kept window", () => {
    const ledger = new SpendLedger();
    ledger.recordSceneTokens(999, { inputTokens: 1_000_000, outputTokens: 0 });
    const snap = ledger.snapshot();
    expect(snap.idle.usd).toBeCloseTo(NEBIUS_INPUT_USD_PER_MILLION_TOKENS, 9);
    expect(snap.scenes).toHaveLength(0);
  });
});

describe("zero and missing usage", () => {
  it("records zero-cost usage without error", () => {
    const ledger = new SpendLedger();
    ledger.recordModeration("rejected", "Ana", "a cat", { inputTokens: 0, outputTokens: 0 });
    const snap = ledger.snapshot();
    expect(snap.notAired.usd).toBe(0);
    expect(snap.byProvider.nebius.calls).toBe(1);
  });

  it("airs a scene with no pending cost (usage came back missing/zero) without throwing", () => {
    const ledger = new SpendLedger();
    expect(() => ledger.markAired(42, "Ana", "a cat")).not.toThrow();
    const scene = ledger.snapshot().scenes[0];
    expect(scene).toEqual({
      ideaId: 42,
      name: "Ana",
      text: "a cat",
      usd: 0,
      byProvider: { fal: 0, nebius: 0, slng: 0, vonage: 0 },
    });
  });
});
