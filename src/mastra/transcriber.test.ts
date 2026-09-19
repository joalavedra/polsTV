import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribe } from "./transcriber";

function sttResponse(transcript: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      results: { channels: [{ alternatives: [{ transcript }], detected_language: "en" }] },
      metadata: { duration: 2.5 },
      ...extra,
    }),
    { status: 200 },
  );
}

describe("transcribe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the transcript and audio duration on success", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => sttResponse("a cat drives a taxi")));
    const result = await transcribe(new Uint8Array([1, 2, 3]), "audio/webm");
    expect(result).toEqual({ text: "a cat drives a taxi", audioSeconds: 2.5 });
  });

  it("sends punctuate/detect_language as multipart form fields, not query params", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => sttResponse("hello"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribe(new Uint8Array([9, 9]), "audio/ogg");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eu-west.api.slng.ai/v1/stt/deepgram/nova:3");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("punctuate")).toBe("true");
    expect(form.get("detect_language")).toBe("true");
    expect(form.get("audio")).toBeInstanceOf(Blob);
  });

  it("throws with the status and body when SLNG rejects the call", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("corrupt audio", { status: 400 })));
    const call = transcribe(new Uint8Array([1]), "audio/webm");
    await expect(call).rejects.toThrow(/400.*corrupt audio/);
  });

  it("propagates a timeout as a failed call", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    await expect(transcribe(new Uint8Array([1]), "audio/webm")).rejects.toThrow(/timeout/i);
  });

  it("fails fast when the key is missing", async () => {
    vi.stubEnv("SLNG_API_KEY", "");
    await expect(transcribe(new Uint8Array([1]), "audio/webm")).rejects.toThrow(/SLNG_API_KEY/);
  });

  it("resolves with an empty transcript for near-silent audio, without throwing", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => sttResponse("")));
    const result = await transcribe(new Uint8Array([0]), "audio/webm");
    expect(result.text).toBe("");
  });

  it("omits audioSeconds when the response carries no duration", async () => {
    vi.stubEnv("SLNG_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "hi" }] }] } }),
            { status: 200 },
          ),
      ),
    );
    const result = await transcribe(new Uint8Array([1]), "audio/webm");
    expect(result).toEqual({ text: "hi" });
    expect("audioSeconds" in result).toBe(false);
  });
});
