import { describe, expect, it, vi } from "vitest";
import type { CatalogItem } from "./catalog";
import { buildSceneRecs, pickBest, type RecsDeps, RecsStore } from "./recs";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "tv:1",
    mediaType: "tv",
    title: "A Show",
    overview: "",
    posterUrl: "https://example.com/p.jpg",
    url: "https://example.com/show",
    ...overrides,
  };
}

function deps(overrides: Partial<RecsDeps> = {}): RecsDeps {
  return {
    writeQuery: vi.fn(async () => ({
      query: {
        moodLine: "deadpan animal comedy",
        candidates: [
          { title: "A Movie", mediaType: "movie" as const },
          { title: "A Show", mediaType: "tv" as const },
        ],
      },
      usage: ZERO_USAGE,
    })),
    lookupCandidates: vi.fn(async () => [
      item({ id: "movie:1", mediaType: "movie", title: "A Movie" }),
      item({ id: "tv:1", mediaType: "tv", title: "A Show" }),
    ]),
    recordTokens: vi.fn(),
    ...overrides,
  };
}

/** Lets `ensure`'s fire-and-forget build settle before the assertions run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RecsStore.ensure", () => {
  it("returns nothing on the first ask and the picks once the build lands", async () => {
    const store = new RecsStore();
    const d = deps();
    expect(store.ensure(d, 7, "a cat runs a laundrette")).toBeUndefined();
    await settle();
    expect(store.ensure(d, 7, "a cat runs a laundrette")?.picks).toHaveLength(2);
    expect(d.writeQuery).toHaveBeenCalledTimes(1);
  });

  it("builds a scene once however many times it is polled while in flight", async () => {
    const store = new RecsStore();
    const d = deps();
    for (let i = 0; i < 5; i += 1) store.ensure(d, 7, "a cat");
    await settle();
    expect(d.writeQuery).toHaveBeenCalledTimes(1);
  });

  it("does not retry a scene whose build failed: one attempt, then cached empty picks", async () => {
    const store = new RecsStore();
    const d = deps({
      writeQuery: vi.fn(async () => {
        throw new Error("nebius down");
      }),
    });
    expect(store.ensure(d, 7, "a cat")).toBeUndefined();
    await settle();
    expect(store.ensure(d, 7, "a cat")).toEqual({ sceneId: 7, moodLine: "", picks: [] });
    store.ensure(d, 7, "a cat");
    await settle();
    expect(d.writeQuery).toHaveBeenCalledTimes(1);
  });

  it("spends nothing on a scene nobody asks about", () => {
    const d = deps();
    new RecsStore().set({ sceneId: 7, moodLine: "", picks: [] });
    expect(d.writeQuery).not.toHaveBeenCalled();
  });
});

describe("pickBest", () => {
  it("keeps the top 3 by rating when everything is the same mediaType", () => {
    const items = [
      item({ id: "tv:1", rating: 5 }),
      item({ id: "tv:2", rating: 9 }),
      item({ id: "tv:3", rating: 7 }),
      item({ id: "tv:4", rating: 1 }),
    ];
    expect(pickBest(items).map((i) => i.id)).toEqual(["tv:2", "tv:3", "tv:1"]);
  });

  it("interleaves movies and series so a film with no rating still gets a slot", () => {
    const items = [
      item({ id: "tv:1", mediaType: "tv", rating: 9 }),
      item({ id: "tv:2", mediaType: "tv", rating: 8 }),
      item({ id: "movie:1", mediaType: "movie" }), // no rating — a real film from catalog.ts
    ];
    const picks = pickBest(items);
    expect(picks.some((i) => i.mediaType === "movie")).toBe(true);
    expect(picks).toHaveLength(3);
  });

  it("returns fewer than the limit when there are fewer candidates", () => {
    expect(pickBest([item()])).toHaveLength(1);
  });
});

describe("buildSceneRecs", () => {
  it("verifies the writer's candidates against the catalog and keeps the best 3", async () => {
    const d = deps();
    const recs = await buildSceneRecs(d, 42, "a cat runs a laundrette");
    expect(d.writeQuery).toHaveBeenCalledWith("a cat runs a laundrette");
    expect(d.lookupCandidates).toHaveBeenCalledWith([
      { title: "A Movie", mediaType: "movie" },
      { title: "A Show", mediaType: "tv" },
    ]);
    expect(recs.sceneId).toBe(42);
    expect(recs.moodLine).toBe("deadpan animal comedy");
    expect(recs.picks).toHaveLength(2);
  });

  it("meters the writer's tokens against the scene id", async () => {
    const d = deps({
      writeQuery: vi.fn(async () => ({
        query: { moodLine: "x", candidates: [{ title: "A", mediaType: "movie" as const }] },
        usage: { inputTokens: 10, outputTokens: 5 },
      })),
    });
    await buildSceneRecs(d, 9, "prompt");
    expect(d.recordTokens).toHaveBeenCalledWith(9, { inputTokens: 10, outputTokens: 5 });
  });

  it("shows nothing when fewer than 2 candidates resolve against the catalog", async () => {
    const d = deps({ lookupCandidates: vi.fn(async () => [item()]) });
    const recs = await buildSceneRecs(d, 1, "prompt");
    expect(recs.picks).toEqual([]);
  });

  it("never throws when the catalog lookup fails, and shows empty picks", async () => {
    const d = deps({
      lookupCandidates: vi.fn(async () => {
        throw new Error("tvmaze/wikipedia both down");
      }),
    });
    await expect(buildSceneRecs(d, 1, "prompt")).resolves.toEqual({ sceneId: 1, moodLine: "", picks: [] });
  });

  it("never throws when the writer itself fails", async () => {
    const d = deps({
      writeQuery: vi.fn(async () => {
        throw new Error("nebius down");
      }),
    });
    await expect(buildSceneRecs(d, 1, "prompt")).resolves.toEqual({ sceneId: 1, moodLine: "", picks: [] });
    expect(d.lookupCandidates).not.toHaveBeenCalled();
  });
});

describe("RecsStore", () => {
  it("returns what was set for a scene id", () => {
    const store = new RecsStore();
    store.set({ sceneId: 1, moodLine: "x", picks: [] });
    expect(store.get(1)).toEqual({ sceneId: 1, moodLine: "x", picks: [] });
    expect(store.get(2)).toBeUndefined();
  });

  it("forgets the oldest scene once more than 10 are kept", () => {
    const store = new RecsStore();
    for (let id = 1; id <= 11; id += 1) store.set({ sceneId: id, moodLine: "x", picks: [] });
    expect(store.get(1)).toBeUndefined();
    expect(store.get(11)).toBeDefined();
  });
});
