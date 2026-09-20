import { describe, expect, it, vi } from "vitest";
import type { PitchDeps } from "./pitch";
import { PITCH_COOLDOWN_MS, PITCH_SLOT_TIMEOUT_MS, PitchSlot, submitPitch } from "./pitch";

function setup() {
  let clock = 1_000_000;
  const slot = new PitchSlot(() => clock);
  const tick = (ms: number) => {
    clock += ms;
  };
  const reserve = (uid = "ana", name = "Ana") =>
    slot.reserve({ uid, name, brief: "sell my lemonade stand" });
  return { slot, tick, reserve };
}

/** The ids one boot's slot hands out over three pitches. */
function pitchIds(slot: PitchSlot): number[] {
  const ids: number[] = [];
  for (const uid of ["ana", "bob", "carol"]) {
    const reserved = slot.reserve({ uid, name: uid, brief: "lemonade" });
    if (!reserved.ok) throw new Error(reserved.reason);
    ids.push(reserved.pitch.id);
    slot.release(reserved.pitch.id);
  }
  return ids;
}

describe("open to everyone", () => {
  it("lets a viewer with no karma reserve the slot", () => {
    const ctx = setup();
    expect(ctx.reserve().ok).toBe(true);
  });
});

/** Reserve, synthesise and hand a pitch to the broadcaster, as submitPitch would. */
function airborne(ctx: ReturnType<typeof setup>, uid = "ana") {
  const reserved = ctx.reserve(uid);
  if (!reserved.ok) throw new Error(reserved.reason);
  ctx.slot.ready(reserved.pitch.id, `announcer/pitch-${reserved.pitch.id}`);
  return reserved.pitch;
}

describe("cooldown", () => {
  it("holds a viewer off until the cooldown has fully elapsed", () => {
    const ctx = setup();
    const pitch = airborne(ctx);
    ctx.slot.take();
    ctx.slot.release(pitch.id);
    ctx.tick(PITCH_COOLDOWN_MS - 1);
    expect(ctx.slot.cooldownSeconds("ana")).toBe(1);
    expect(ctx.reserve().ok).toBe(false);
    ctx.tick(1);
    expect(ctx.slot.cooldownSeconds("ana")).toBe(0);
    expect(ctx.reserve().ok).toBe(true);
  });

  it("is per viewer, not channel-wide", () => {
    const ctx = setup();
    ctx.slot.release(airborne(ctx, "ana").id);
    expect(ctx.slot.cooldownSeconds("bob")).toBe(0);
    expect(ctx.reserve("bob", "Bob").ok).toBe(true);
  });

  it("stands after a brief is turned down, but not after the channel's own failure", () => {
    const rejected = setup();
    const first = rejected.reserve();
    if (!first.ok) throw new Error("setup failed");
    rejected.slot.release(first.pitch.id);
    expect(rejected.slot.cooldownSeconds("ana")).toBeGreaterThan(0);

    const broke = setup();
    const second = broke.reserve();
    if (!second.ok) throw new Error("setup failed");
    broke.slot.abandon(second.pitch.id);
    expect(broke.slot.cooldownSeconds("ana")).toBe(0);
  });
});

describe("one pitch at a time", () => {
  it("turns a second viewer away while one is in the air, naming who has the slot", () => {
    const ctx = setup();
    airborne(ctx, "ana");
    const second = ctx.reserve("bob", "Bob");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("busy");
    expect(second.reason).toContain("Ana");
  });

  it("frees the slot for the next viewer once the pitch has played", () => {
    const ctx = setup();
    const first = airborne(ctx, "ana");
    ctx.slot.take();
    ctx.slot.release(first.id);
    expect(ctx.reserve("bob", "Bob").ok).toBe(true);
  });

  it("hands a pitch to the broadcaster exactly once", () => {
    const ctx = setup();
    const pitch = airborne(ctx);
    expect(ctx.slot.take()?.url).toBe(`announcer/pitch-${pitch.id}`);
    expect(ctx.slot.take()).toBeUndefined();
  });

  it("never hands out a pitch whose ad read is still being written", () => {
    const ctx = setup();
    ctx.reserve();
    expect(ctx.slot.take()).toBeUndefined();
    expect(ctx.slot.status()).toBeUndefined();
  });

  it("gives every boot its own pitch ids so a restarted server never reuses one", () => {
    // The broadcaster page outlives a server restart and skips any clip id it has already
    // played, so a reused pitch id means that viewer's ad read silently never airs.
    const firstIds = pitchIds(new PitchSlot(() => 1_000_000));
    const secondIds = pitchIds(new PitchSlot(() => 1_000_500)); // a restart half a second later
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
  });

  it("ignores results and readiness for a pitch that is not the current one", () => {
    const ctx = setup();
    const pitch = airborne(ctx);
    ctx.slot.release(pitch.id + 99);
    ctx.slot.abandon(pitch.id + 99);
    expect(ctx.slot.ready(pitch.id + 99, "announcer/x")).toBe(false);
    expect(ctx.slot.take()?.id).toBe(pitch.id);
  });
});

describe("slot timeout", () => {
  it("keeps waiting right up to the deadline, then drops the pitch", () => {
    const ctx = setup();
    airborne(ctx);
    ctx.tick(PITCH_SLOT_TIMEOUT_MS - 1);
    expect(ctx.slot.status()?.state).toBe("pending");
    ctx.tick(1);
    expect(ctx.slot.status()?.state).toBe("dropped");
    expect(ctx.slot.take()).toBeUndefined();
  });

  it("reports a dropped pitch once, so the viewer is told once", () => {
    const ctx = setup();
    airborne(ctx);
    ctx.tick(PITCH_SLOT_TIMEOUT_MS);
    ctx.slot.sweep();
    expect(ctx.slot.takeDropped()?.uid).toBe("ana");
    expect(ctx.slot.takeDropped()).toBeUndefined();
  });

  it("drops a pitch the broadcaster took but never reported on", () => {
    const ctx = setup();
    airborne(ctx);
    ctx.slot.take();
    ctx.tick(PITCH_SLOT_TIMEOUT_MS);
    expect(ctx.slot.status()?.state).toBe("dropped");
  });

  it("shows a dropped pitch long enough to be seen, then forgets it", () => {
    const ctx = setup();
    airborne(ctx, "ana");
    ctx.tick(PITCH_SLOT_TIMEOUT_MS);
    expect(ctx.slot.status()?.state).toBe("dropped");
    ctx.tick(PITCH_SLOT_TIMEOUT_MS);
    expect(ctx.slot.status()).toBeUndefined();
  });

  it("lets the next viewer take the slot while the dropped one is still showing", () => {
    const ctx = setup();
    airborne(ctx, "ana");
    ctx.tick(PITCH_SLOT_TIMEOUT_MS);
    expect(ctx.reserve("bob", "Bob").ok).toBe(true);
    expect(ctx.slot.status()).toBeUndefined(); // Bob's is still being written
  });

  it("refuses to revive a pitch whose ad read arrived after the deadline", () => {
    const ctx = setup();
    const reserved = ctx.reserve();
    if (!reserved.ok) throw new Error("setup failed");
    ctx.tick(PITCH_SLOT_TIMEOUT_MS);
    ctx.slot.sweep();
    expect(ctx.slot.ready(reserved.pitch.id, "announcer/pitch-1")).toBe(false);
  });
});

describe("status", () => {
  it("carries the name, brief and state for the viewer badge", () => {
    const ctx = setup();
    airborne(ctx);
    expect(ctx.slot.status()).toEqual({
      name: "Ana",
      brief: "sell my lemonade stand",
      state: "pending",
    });
    ctx.slot.take();
    expect(ctx.slot.status()?.state).toBe("playing");
  });
});

describe("submitPitch", () => {
  function deps(overrides: Partial<PitchDeps> = {}): PitchDeps {
    return {
      moderate: async () => ({
        verdict: { ok: true, reason: "" },
        usage: { inputTokens: 10, outputTokens: 2 },
      }),
      writeAdRead: async () => ({
        line: "A word from Ana. Lemonade, probably.",
        usage: { inputTokens: 20, outputTokens: 12 },
      }),
      synthesise: async (clipId) => clipId,
      clipBytes: () => 32_000,
      recordTokens: vi.fn(),
      recordTts: vi.fn(),
      ...overrides,
    };
  }

  const input = { uid: "ana", name: "Ana", brief: "sell my lemonade stand" };

  it("returns the ad read and leaves the pitch waiting for the broadcaster", async () => {
    const slot = new PitchSlot();
    const result = await submitPitch(slot, deps(), input);
    expect(result).toEqual({ ok: true, line: "A word from Ana. Lemonade, probably." });
    const taken = slot.take();
    expect(taken?.url).toBe(`announcer/pitch-${taken?.id}`);
  });

  it("meters both Nebius calls and the clip on the pitches line", async () => {
    const d = deps();
    await submitPitch(new PitchSlot(), d, input);
    expect(d.recordTokens).toHaveBeenCalledTimes(2);
    expect(d.recordTts).toHaveBeenCalledWith(32_000);
  });

  it("charges the moderation call but airs nothing when a brief is turned down", async () => {
    const d = deps({
      moderate: async () => ({
        verdict: { ok: false, reason: "No real brands." },
        usage: { inputTokens: 10, outputTokens: 2 },
      }),
    });
    const slot = new PitchSlot();
    const result = await submitPitch(slot, d, input);
    expect(result).toEqual({ ok: false, code: "rejected", reason: "No real brands." });
    expect(d.recordTokens).toHaveBeenCalledTimes(1);
    expect(slot.take()).toBeUndefined();
    expect(slot.cooldownSeconds("ana")).toBeGreaterThan(0);
  });

  it("fails closed and frees the slot when moderation itself is down", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const slot = new PitchSlot();
    const d = deps({
      moderate: async () => {
        throw new Error("nebius down");
      },
    });
    const result = await submitPitch(slot, d, input);
    expect(result).toEqual({ ok: false, code: "unavailable", reason: expect.any(String) });
    expect(slot.take()).toBeUndefined();
    expect(slot.cooldownSeconds("ana")).toBe(0);
    consoleError.mockRestore();
  });

  it("frees the slot when the voice cannot synthesise the read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const slot = new PitchSlot();
    const d = deps({
      synthesise: async () => {
        throw new Error("slng 429");
      },
    });
    expect((await submitPitch(slot, d, input)).ok).toBe(false);
    expect(slot.status()).toBeUndefined();
    consoleError.mockRestore();
  });

  it("holds the slot while it writes, so two viewers cannot both pay for one", async () => {
    const slot = new PitchSlot();
    const d = deps();
    const first = submitPitch(slot, d, input);
    const second = await submitPitch(slot, d, { ...input, uid: "bob", name: "Bob" });
    expect(second).toEqual({ ok: false, code: "busy", reason: expect.any(String) });
    expect((await first).ok).toBe(true);
  });
});
