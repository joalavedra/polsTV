import { describe, expect, it } from "vitest";
import { TICKER_ITEM_TTL_MS, TICKER_MAX_ITEMS, Ticker } from "./ticker";

function setup() {
  let clock = 1_000_000;
  const ticker = new Ticker(() => clock);
  const tick = (ms: number) => {
    clock += ms;
  };
  const add = (uid: string, overrides: { caption?: string } = {}) =>
    ticker.add({
      uid,
      name: uid.toUpperCase(),
      mime: "image/jpeg",
      bytes: new Uint8Array([1, 2, 3]),
      ...overrides,
    });
  return { ticker, tick, add };
}

describe("add", () => {
  it("assigns increasing ids and lists newest last", () => {
    const { ticker, add } = setup();
    const a = add("ana");
    const b = add("bob");
    expect(b.id).toBeGreaterThan(a.id);
    expect(ticker.list().map((item) => item.uid)).toEqual(["ana", "bob"]);
  });

  it("keeps caption undefined when none was given", () => {
    const { add } = setup();
    expect(add("ana").caption).toBeUndefined();
  });

  it("replaces a user's previous item instead of adding alongside it", () => {
    const { ticker, add } = setup();
    add("ana", { caption: "first" });
    add("ana", { caption: "second" });
    const items = ticker.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.caption).toBe("second");
  });

  it("drops the oldest item once there are more than the cap", () => {
    const { ticker, add } = setup();
    for (let i = 0; i < TICKER_MAX_ITEMS + 1; i += 1) add(`user${i}`);
    const items = ticker.list();
    expect(items).toHaveLength(TICKER_MAX_ITEMS);
    expect(items[0]?.uid).toBe("user1"); // user0 was the oldest, dropped
    expect(items.at(-1)?.uid).toBe(`user${TICKER_MAX_ITEMS}`);
  });
});

describe("expiry", () => {
  it("drops an item once it is older than the TTL", () => {
    const { ticker, add, tick } = setup();
    add("ana");
    tick(TICKER_ITEM_TTL_MS - 1);
    expect(ticker.list()).toHaveLength(1);
    tick(1);
    expect(ticker.list()).toHaveLength(0);
  });

  it("get() returns undefined for an expired item's id", () => {
    const { ticker, add, tick } = setup();
    const item = add("ana");
    tick(TICKER_ITEM_TTL_MS + 1);
    expect(ticker.get(item.id)).toBeUndefined();
  });
});

describe("get", () => {
  it("returns the item by id, undefined when unknown", () => {
    const { ticker, add } = setup();
    const item = add("ana");
    expect(ticker.get(item.id)?.uid).toBe("ana");
    expect(ticker.get(99999)).toBeUndefined();
  });
});
