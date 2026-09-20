import { describe, expect, it } from "vitest";
import { Channel, MAX_AMENDS_PER_SCENE, STEER_GAP_MS, STEER_TIMEOUT_MS } from "./channel";

function setup() {
  let clock = 1_000_000;
  const channel = new Channel(() => clock);
  const tick = (ms: number) => {
    clock += ms;
  };
  const say = (uid: string, text: string) =>
    channel.addIdea({ uid, name: uid.toUpperCase(), text, source: "web" });
  const amend = (uid: string, text: string) =>
    channel.addIdea({ uid, name: uid.toUpperCase(), text, source: "web", kind: "amend" });
  return { channel, tick, say, amend };
}

/** Queue an idea, steer it, and mark the steer applied so it is the scene on air. */
function air(ctx: ReturnType<typeof setup>, uid: string, text: string) {
  const added = ctx.say(uid, text);
  if (!added.ok) throw new Error(added.reason);
  ctx.tick(STEER_GAP_MS);
  const steer = ctx.channel.beginSteer(added.idea.id, `prompt for ${text}`);
  return ctx.channel.resolveSteer(steer.steerId, true);
}

/** Queue an amend, steer it, and mark the steer applied so it lands on the scene on air. */
function applyAmend(ctx: ReturnType<typeof setup>, uid: string, text: string) {
  const added = ctx.amend(uid, text);
  if (!added.ok) throw new Error(added.reason);
  ctx.tick(STEER_GAP_MS);
  const steer = ctx.channel.beginSteer(added.idea.id, `prompt for ${text}`);
  return ctx.channel.resolveSteer(steer.steerId, true);
}

describe("queue", () => {
  it("allows one queued idea per user", () => {
    const ctx = setup();
    expect(ctx.say("ana", "a cat").ok).toBe(true);
    const second = ctx.say("ana", "a dog");
    expect(second.ok).toBe(false);
    expect(ctx.say("bob", "a dog").ok).toBe(true);
  });

  it("lets a user queue again once their idea aired", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    expect(ctx.say("ana", "a dog").ok).toBe(true);
  });

  it("picks the oldest idea when karma is equal, highest karma otherwise", () => {
    const ctx = setup();
    air(ctx, "bob", "opening scene");
    ctx.channel.like("carol");
    ctx.say("ana", "first in");
    ctx.tick(1);
    ctx.say("bob", "second in, but has karma");
    expect(ctx.channel.nextIdea()?.uid).toBe("bob");
  });

  it("returns undefined when the queue is empty", () => {
    expect(setup().channel.nextIdea()).toBeUndefined();
  });

  it("reports 1-based serving-order position, undefined when not queued", () => {
    const ctx = setup();
    air(ctx, "bob", "opening scene");
    ctx.channel.like("carol"); // bob now has karma, so a later "bob" idea would jump the line
    ctx.say("ana", "first in");
    ctx.tick(1);
    ctx.say("bob", "second in, but has karma");
    expect(ctx.channel.queuePosition("bob")).toBe(1);
    expect(ctx.channel.queuePosition("ana")).toBe(2);
    expect(ctx.channel.queuePosition("nobody")).toBeUndefined();
  });

  it("looks up a user's own queued idea", () => {
    const ctx = setup();
    ctx.say("ana", "a cat");
    expect(ctx.channel.myIdea("ana")?.text).toBe("a cat");
    expect(ctx.channel.myIdea("bob")).toBeUndefined();
  });
});

describe("steering", () => {
  it("refuses a second steer while one is in flight", () => {
    const ctx = setup();
    const a = ctx.say("ana", "a cat");
    const b = ctx.say("bob", "a dog");
    if (!a.ok || !b.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    ctx.channel.beginSteer(a.idea.id, "p");
    expect(ctx.channel.canSteer()).toBe(false);
    expect(() => ctx.channel.beginSteer(b.idea.id, "p")).toThrow();
  });

  it("enforces the gap between steers even after the previous one resolved", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    ctx.say("bob", "a dog");
    expect(ctx.channel.canSteer()).toBe(false);
    ctx.tick(STEER_GAP_MS);
    expect(ctx.channel.canSteer()).toBe(true);
  });

  it("drops a rejected idea and keeps the previous scene on air", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    const bad = ctx.say("bob", "rejected by director");
    if (!bad.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    const steer = ctx.channel.beginSteer(bad.idea.id, "p");
    const outcome = ctx.channel.resolveSteer(steer.steerId, false);
    expect(outcome).toEqual({ onAir: undefined, ended: undefined, amended: false });
    const status = ctx.channel.status();
    expect(status.now?.text).toBe("a cat");
    expect(status.queue).toHaveLength(0);
    expect(status.steering).toBeNull();
  });

  it("holds an in-flight steer until it times out, then lets the queue move", () => {
    const ctx = setup();
    const added = ctx.say("ana", "a cat");
    if (!added.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    const steer = ctx.channel.beginSteer(added.idea.id, "p");
    ctx.tick(STEER_TIMEOUT_MS - 1);
    expect(ctx.channel.expireStaleSteer()).toBeUndefined();
    expect(ctx.channel.canSteer()).toBe(false);
    ctx.tick(1);
    expect(ctx.channel.expireStaleSteer()).toEqual(steer);
    // Reported once, so the caller cannot file its cost or log it twice.
    expect(ctx.channel.expireStaleSteer()).toBeUndefined();
    expect(ctx.channel.canSteer()).toBe(true);
    expect(ctx.channel.status().steering).toBeNull();
    expect(ctx.channel.status().queue).toHaveLength(0);
    expect(ctx.say("ana", "a dog").ok).toBe(true);
  });

  it("gives every boot its own steer ids so a restarted server never reuses one", () => {
    // The broadcaster page survives a server restart and drops any steer whose id it has already
    // acted on, so two boots handing out the same id wedge the queue for good.
    const ids = (startClock: number) => {
      let clock = startClock;
      const channel = new Channel(() => clock);
      const seen: number[] = [];
      for (const uid of ["ana", "bob", "carol"]) {
        const added = channel.addIdea({ uid, name: uid, text: "a cat", source: "web" });
        if (!added.ok) throw new Error("setup failed");
        clock += STEER_GAP_MS;
        const steer = channel.beginSteer(added.idea.id, "p");
        seen.push(added.idea.id, steer.steerId);
        channel.resolveSteer(steer.steerId, true);
      }
      return seen;
    };
    const first = ids(1_000_000);
    const second = ids(1_000_500); // a restart half a second later
    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });

  it("ignores a result for a steer id that is not in flight", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    const outcome = ctx.channel.resolveSteer(9999, true);
    expect(outcome).toEqual({ onAir: undefined, ended: undefined, amended: false });
    expect(ctx.channel.status().now?.text).toBe("a cat");
  });

  it("reports no ended scene when the first-ever idea airs", () => {
    const ctx = setup();
    const a = ctx.say("ana", "a cat");
    if (!a.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    const steer = ctx.channel.beginSteer(a.idea.id, "p");
    const outcome = ctx.channel.resolveSteer(steer.steerId, true);
    expect(outcome.onAir?.text).toBe("a cat");
    expect(outcome.ended).toBeUndefined();
  });

  it("reports the replaced scene as ended when a new one airs", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    const b = ctx.say("bob", "a dog");
    if (!b.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    const steer = ctx.channel.beginSteer(b.idea.id, "p");
    const outcome = ctx.channel.resolveSteer(steer.steerId, true);
    expect(outcome.onAir?.text).toBe("a dog");
    expect(outcome.ended?.text).toBe("a cat");
  });

  it("carries the announcer clip on the steer only when there is one", () => {
    const ctx = setup();
    const a = ctx.say("ana", "a cat");
    if (!a.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    expect(ctx.channel.beginSteer(a.idea.id, "p", "/announcer/x").announcerUrl).toBe("/announcer/x");
    ctx.channel.resolveSteer(ctx.channel.pendingSteer()?.steerId ?? -1, true);
    const b = ctx.say("bob", "a dog");
    if (!b.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    expect(ctx.channel.beginSteer(b.idea.id, "p")).not.toHaveProperty("announcerUrl");
  });

  it("refuses to steer an idea that is not queued", () => {
    const ctx = setup();
    ctx.tick(STEER_GAP_MS);
    expect(() => ctx.channel.beginSteer(42, "p")).toThrow();
  });

  it("shows the in-flight idea as steering, not in the queue", () => {
    const ctx = setup();
    const a = ctx.say("ana", "a cat");
    if (!a.ok) throw new Error("setup failed");
    ctx.tick(STEER_GAP_MS);
    ctx.channel.beginSteer(a.idea.id, "p");
    const status = ctx.channel.status();
    expect(status.steering).toEqual({ name: "ANA", text: "a cat", kind: "new" });
    expect(status.queue).toHaveLength(0);
  });
});

describe("amends", () => {
  it("refuses an amend when nothing is on air", () => {
    const ctx = setup();
    const result = ctx.amend("ana", "add a hat");
    expect(result).toEqual({
      ok: false,
      reason: "Nothing is on air to change yet; send an idea first.",
    });
  });

  it("accepts an amend once a scene is on air, tagged with the scene it targets", () => {
    const ctx = setup();
    const aired = air(ctx, "ana", "a cat");
    const result = ctx.amend("bob", "add a hat");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("setup failed");
    expect(result.idea.forIdeaId).toBe(aired.onAir?.ideaId);
  });

  it("refuses a 4th amend once a scene has had its three changes", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    applyAmend(ctx, "bob", "change 1");
    applyAmend(ctx, "carol", "change 2");
    applyAmend(ctx, "dave", "change 3");
    const fourth = ctx.amend("erin", "change 4");
    expect(fourth).toEqual({
      ok: false,
      reason: "This scene has had its three changes; send a new idea.",
    });
  });

  it(`allows exactly ${MAX_AMENDS_PER_SCENE} amends on one scene`, () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    const outcome1 = applyAmend(ctx, "bob", "change 1");
    const outcome2 = applyAmend(ctx, "carol", "change 2");
    const outcome3 = applyAmend(ctx, "dave", "change 3");
    expect(outcome3.onAir?.amends).toEqual([
      { name: "BOB", text: "change 1" },
      { name: "CAROL", text: "change 2" },
      { name: "DAVE", text: "change 3" },
    ]);
    expect(outcome1.onAir).toBe(outcome2.onAir);
    expect(outcome2.onAir).toBe(outcome3.onAir);
  });

  it("orders amends ahead of new ideas, oldest amend first", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    ctx.say("bob", "a totally new scene");
    ctx.tick(1);
    ctx.amend("carol", "add a hat");
    ctx.tick(1);
    ctx.amend("dave", "make it snow");

    expect(ctx.channel.nextIdea()?.uid).toBe("carol");
    ctx.channel.dropIdea(ctx.channel.nextIdea()?.id ?? -1);
    expect(ctx.channel.nextIdea()?.uid).toBe("dave");
    ctx.channel.dropIdea(ctx.channel.nextIdea()?.id ?? -1);
    expect(ctx.channel.nextIdea()?.uid).toBe("bob");
  });

  it("respects the steer gap and one-in-flight rule for amends like any other steer", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    const added = ctx.amend("bob", "add a hat");
    if (!added.ok) throw new Error("setup failed");
    expect(ctx.channel.canSteer()).toBe(false);
    expect(() => ctx.channel.beginSteer(added.idea.id, "p")).toThrow();
    ctx.tick(STEER_GAP_MS);
    expect(ctx.channel.canSteer()).toBe(true);
    ctx.channel.beginSteer(added.idea.id, "p");
    expect(ctx.channel.canSteer()).toBe(false);
  });

  it("keeps karma flowing to the original prompter after an amend", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    applyAmend(ctx, "bob", "add a hat");
    ctx.channel.like("carol");
    expect(ctx.channel.karmaOf("ana")).toBe(1);
    expect(ctx.channel.karmaOf("bob")).toBe(0);
    expect(ctx.channel.status().now?.uid).toBe("ana");
    expect(ctx.channel.status().now?.karma).toBe(1);
  });

  it("does not end the scene when an amend is applied, and keeps the scene's identity", () => {
    const ctx = setup();
    const original = air(ctx, "ana", "a cat");
    const outcome = applyAmend(ctx, "bob", "add a hat");
    expect(outcome.ended).toBeUndefined();
    expect(outcome.amended).toBe(true);
    expect(outcome.onAir?.ideaId).toBe(original.onAir?.ideaId);
    expect(outcome.onAir?.uid).toBe("ana");
    expect(outcome.onAir?.text).toBe("a cat");
    expect(outcome.onAir?.prompt).toBe("prompt for add a hat");
    expect(outcome.onAir?.amends).toEqual([{ name: "BOB", text: "add a hat" }]);
    expect(ctx.channel.status().steering).toBeNull();
  });

  it("flags an amend as stale once its target scene is no longer on air", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    const added = ctx.amend("bob", "add a hat");
    if (!added.ok) throw new Error("setup failed");
    expect(ctx.channel.isStaleAmend(added.idea)).toBe(false);
    air(ctx, "carol", "a dog");
    expect(ctx.channel.isStaleAmend(added.idea)).toBe(true);
  });

  it("refuses to apply an amend whose target scene already ended", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    const added = ctx.amend("bob", "add a hat");
    if (!added.ok) throw new Error("setup failed");
    air(ctx, "carol", "a dog");
    ctx.tick(STEER_GAP_MS);
    const steer = ctx.channel.beginSteer(added.idea.id, "p");
    expect(() => ctx.channel.resolveSteer(steer.steerId, true)).toThrow();
  });
});

describe("likes and karma", () => {
  it("shows current karma on chat lines posted before the likes came in", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    ctx.channel.like("bob");
    expect(ctx.channel.status().chat[0]).toMatchObject({ name: "ANA", karma: 1 });
    expect(ctx.channel.status().chat[0]).not.toHaveProperty("uid");
  });

  it("credits the prompter once per viewer per scene", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    expect(ctx.channel.like("bob")).toBe(true);
    expect(ctx.channel.like("bob")).toBe(false);
    expect(ctx.channel.like("carol")).toBe(true);
    expect(ctx.channel.karmaOf("ana")).toBe(2);
    expect(ctx.channel.status().now?.likes).toBe(2);
    expect(ctx.channel.status().now?.karma).toBe(2);
  });

  it("does not let you like your own scene or like before anything aired", () => {
    const ctx = setup();
    expect(ctx.channel.like("bob")).toBe(false);
    air(ctx, "ana", "a cat");
    expect(ctx.channel.like("ana")).toBe(false);
    expect(ctx.channel.karmaOf("ana")).toBe(0);
  });

  it("lets the same viewer like the next scene", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    ctx.channel.like("bob");
    air(ctx, "ana", "a dog");
    expect(ctx.channel.like("bob")).toBe(true);
    expect(ctx.channel.status().rank).toEqual([{ name: "ANA", karma: 2 }]);
  });
});

describe("presence", () => {
  it("counts viewers seen recently and expires the rest", () => {
    const ctx = setup();
    ctx.channel.sawViewer("a");
    ctx.channel.sawViewer("b");
    expect(ctx.channel.status().viewers).toBe(2);
    ctx.tick(11_000);
    ctx.channel.sawViewer("b");
    expect(ctx.channel.status().viewers).toBe(1);
  });

  it("is live only while the broadcaster keeps polling", () => {
    const ctx = setup();
    expect(ctx.channel.status().live).toBe(false);
    ctx.channel.sawBroadcaster();
    expect(ctx.channel.status().live).toBe(true);
    ctx.tick(16_000);
    expect(ctx.channel.status().live).toBe(false);
  });
});
