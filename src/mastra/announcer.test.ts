import { afterEach, describe, expect, it, vi } from "vitest";
import { announcerLine, clip, synthesise } from "./announcer";

describe("announcerLine", () => {
  it("reads a short idea in full", () => {
    expect(announcerLine("Timba", "a snake bursts out of a toilet")).toBe(
      "Up next, from Timba: a snake bursts out of a toilet",
    );
  });

  it("collapses whitespace and newlines", () => {
    expect(announcerLine("Ana", "  a cat\n\n on   a boat ")).toBe("Up next, from Ana: a cat on a boat");
  });

  it("cuts a long idea at a word boundary", () => {
    const long = "a very long idea about clowns ".repeat(10);
    const line = announcerLine("Ana", long);
    expect(line.endsWith(", and more.")).toBe(true);
    expect(line.length).toBeLessThan(160);
    expect(line).not.toMatch(/clow, and more\.$/);
  });

  it("still returns something for one unbroken long word", () => {
    expect(announcerLine("Ana", "x".repeat(300)).startsWith("Up next, from Ana: x")).toBe(true);
  });
});

describe("synthesise", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("stores the audio under the clip id", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    await synthesise("clip-a", "hello");
    expect(clip("clip-a")).toEqual(Buffer.from([1, 2, 3]));
  });

  it("throws with the status and body when SLNG rejects the call", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota exceeded", { status: 429 })));
    await expect(synthesise("clip-b", "hello")).rejects.toThrow(/429.*quota exceeded/);
    expect(clip("clip-b")).toBeUndefined();
  });

  it("fails fast when the key is missing", async () => {
    vi.stubEnv("SLNG_API_KEY", "");
    await expect(synthesise("clip-c", "hello")).rejects.toThrow(/SLNG_API_KEY/);
  });

  it("forgets the oldest clips", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 })));
    for (let index = 0; index < 10; index += 1) await synthesise(`keep-${index}`, "hello");
    expect(clip("keep-0")).toBeUndefined();
    expect(clip("keep-9")).toBeDefined();
  });
});
