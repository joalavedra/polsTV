import { afterEach, describe, expect, it, vi } from "vitest";
import { clip, clipLine, synthesise } from "./announcer";

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

  it("wraps a network failure with clip context and the original cause", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    const networkError = new Error("ECONNRESET");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw networkError;
      }),
    );
    await expect(synthesise("clip-network", "hello")).rejects.toThrow(/clip-network/);
    await expect(synthesise("clip-network", "hello")).rejects.toMatchObject({
      cause: networkError,
    });
  });

  it("prepends the silent [excited] tone marker to the text sent to SLNG", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(new Uint8Array([1]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await synthesise("clip-d", "A word from Ana. Hello.");
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init?.body as string) as { text: string };
    expect(body.text).toBe("[excited] A word from Ana. Hello.");
  });

  it("forgets the oldest clips", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 })));
    for (let index = 0; index < 10; index += 1) await synthesise(`keep-${index}`, "hello");
    expect(clip("keep-0")).toBeUndefined();
    expect(clip("keep-9")).toBeDefined();
  });

  it("keeps the clean line, without the TTS tone marker, for clipLine()", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })));
    await synthesise("clip-e", "A word from Ana. Hello.");
    expect(clipLine("clip-e")).toBe("A word from Ana. Hello.");
  });

  it("drops a clip's line together with its audio once evicted", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 })));
    for (let index = 0; index < 10; index += 1) await synthesise(`evict-${index}`, `line ${index}`);
    expect(clipLine("evict-0")).toBeUndefined();
    expect(clipLine("evict-9")).toBe("line 9");
  });
});
