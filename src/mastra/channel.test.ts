import { describe, expect, it } from "vitest";
import { Channel, STEER_GAP_MS } from "./channel";

function setup() {
  let clock = 1_000_000;
  const channel = new Channel(() => clock);
  const tick = (ms: number) => {
    clock += ms;
  };
  const say = (uid: string, text: string) =>
    channel.addIdea({ uid, name: uid.toUpperCase(), text, source: "web" });
  return { channel, tick, say };
}

/** Queue an idea, steer it, and mark the steer applied so it is the scene on air. */
function air(ctx: ReturnType<typeof setup>, uid: string, text: string) {
  const added = ctx.say(uid, text);
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
    expect(ctx.channel.resolveSteer(steer.steerId, false)).toBeUndefined();
    const status = ctx.channel.status();
    expect(status.now?.text).toBe("a cat");
    expect(status.queue).toHaveLength(0);
    expect(status.steering).toBeNull();
  });

  it("ignores a result for a steer id that is not in flight", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    expect(ctx.channel.resolveSteer(9999, true)).toBeUndefined();
    expect(ctx.channel.status().now?.text).toBe("a cat");
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
    expect(status.steering).toEqual({ name: "ANA", text: "a cat" });
    expect(status.queue).toHaveLength(0);
  });
});

describe("likes and karma", () => {
  it("credits the prompter once per viewer per scene", () => {
    const ctx = setup();
    air(ctx, "ana", "a cat");
    expect(ctx.channel.like("bob")).toBe(true);
    expect(ctx.channel.like("bob")).toBe(false);
    expect(ctx.channel.like("carol")).toBe(true);
    expect(ctx.channel.karmaOf("ana")).toBe(2);
    expect(ctx.channel.status().now?.likes).toBe(2);
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
