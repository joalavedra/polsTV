import { describe, expect, it } from "vitest";
import { HISTORY_MAX_ENTRIES, HISTORY_PER_VIEWER, History } from "./history";

function entry(ideaId: number, pid: string, airedAt: number) {
  return { ideaId, pid, name: pid.toUpperCase(), text: `scene ${ideaId}`, airedAt };
}

describe("record", () => {
  it("upserts by ideaId instead of duplicating", () => {
    const history = new History();
    history.record(entry(1, "aaa", 100));
    history.record({ ...entry(1, "aaa", 200), text: "changed" });
    expect(history.byViewer("aaa")).toHaveLength(1);
    expect(history.byViewer("aaa")[0]?.text).toBe("changed");
  });

  it("keeps entries newest first", () => {
    const history = new History();
    history.record(entry(1, "aaa", 100));
    history.record(entry(2, "aaa", 300));
    history.record(entry(3, "aaa", 200));
    expect(history.byViewer("aaa").map((e) => e.ideaId)).toEqual([2, 3, 1]);
  });

  it("caps what byViewer returns at HISTORY_PER_VIEWER", () => {
    const history = new History();
    for (let i = 0; i < HISTORY_PER_VIEWER + 5; i++) history.record(entry(i, "aaa", i));
    expect(history.byViewer("aaa")).toHaveLength(HISTORY_PER_VIEWER);
    // newest first: the highest ideaIds (most recently aired) survive the per-viewer slice
    expect(history.byViewer("aaa")[0]?.ideaId).toBe(HISTORY_PER_VIEWER + 4);
  });

  it("evicts the oldest entry overall once past HISTORY_MAX_ENTRIES and reports it", () => {
    const history = new History();
    for (let i = 0; i < HISTORY_MAX_ENTRIES; i++) history.record(entry(i, `p${i}`, i));
    const evicted = history.record(entry(HISTORY_MAX_ENTRIES, "pnew", HISTORY_MAX_ENTRIES));
    expect(evicted).toEqual([0]);
    expect(history.byViewer("p0")).toHaveLength(0);
    expect(history.all()).toHaveLength(HISTORY_MAX_ENTRIES);
  });
});

describe("byViewer", () => {
  it("returns an empty list for an unknown pid", () => {
    const history = new History();
    history.record(entry(1, "aaa", 100));
    expect(history.byViewer("unknown")).toEqual([]);
  });
});

describe("load", () => {
  it("rebuilds from a persisted list, newest first regardless of input order", () => {
    const history = new History();
    history.load([entry(1, "aaa", 100), entry(2, "aaa", 300)]);
    expect(history.byViewer("aaa").map((e) => e.ideaId)).toEqual([2, 1]);
  });
});
