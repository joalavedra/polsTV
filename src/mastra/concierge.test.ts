import { describe, expect, it, vi } from "vitest";
import type { CatalogItem } from "./catalog";
import type { ConciergeRawReply, TvAskDeps, TvAskInput } from "./concierge";
import { handleTvAsk } from "./concierge";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

function catalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "tv:1",
    mediaType: "tv",
    title: "Severance",
    overview: "A workplace thriller.",
    posterUrl: "https://example.com/p.jpg",
    url: "https://example.com/show",
    ...overrides,
  };
}

function reply(overrides: Partial<ConciergeRawReply> = {}): ConciergeRawReply {
  return {
    say: "You'd like Severance, it's tense and strange.",
    pickRefs: [{ id: "tv:1", mediaType: "tv" }],
    askedFollowUp: false,
    toolResults: [catalogItem()],
    usage: ZERO_USAGE,
    ...overrides,
  };
}

function deps(overrides: Partial<TvAskDeps> = {}): TvAskDeps {
  return {
    transcribe: vi.fn(async () => ({ text: "something tense", audioSeconds: 2 })),
    detailsFor: vi.fn(async () => undefined),
    onAirContext: vi.fn(() => undefined),
    runConcierge: vi.fn(async () => reply()),
    synthesise: vi.fn(async () => "clip-1"),
    clipBytes: vi.fn(() => 16_000),
    submitVibe: vi.fn(async () => ({ queued: true })),
    recordStt: vi.fn(),
    recordTokens: vi.fn(),
    recordTts: vi.fn(),
    ...overrides,
  };
}

const textInput: TvAskInput = { uid: "viewer-1", text: "something tense" };

describe("handleTvAsk: transcript boundary", () => {
  it("422s with the heard transcript when speech is too short to be real", async () => {
    const d = deps({ transcribe: vi.fn(async () => ({ text: "  ", audioSeconds: 0.2 })) });
    const outcome = await handleTvAsk(d, { uid: "u1", audio: { bytes: new Uint8Array([1]), mime: "audio/webm" } });
    expect(outcome).toMatchObject({ status: 422, body: { ok: false, heard: "" } });
    expect(d.runConcierge).not.toHaveBeenCalled();
  });

  it("422s on empty typed text too", async () => {
    const d = deps();
    const outcome = await handleTvAsk(d, { uid: "u1", text: "" });
    expect(outcome.status).toBe(422);
  });

  it("503s when transcription itself fails, without calling the concierge", async () => {
    const d = deps({
      transcribe: vi.fn(async () => {
        throw new Error("SLNG down");
      }),
    });
    const outcome = await handleTvAsk(d, { uid: "u1", audio: { bytes: new Uint8Array([1]), mime: "audio/webm" } });
    expect(outcome.status).toBe(503);
    expect(d.runConcierge).not.toHaveBeenCalled();
  });

  it("records STT cost when audio was transcribed", async () => {
    const d = deps();
    await handleTvAsk(d, { uid: "u1", audio: { bytes: new Uint8Array([1]), mime: "audio/webm" } });
    expect(d.recordStt).toHaveBeenCalledWith(2);
  });

  it("never calls recordStt on the typed-text path", async () => {
    const d = deps();
    await handleTvAsk(d, textInput);
    expect(d.recordStt).not.toHaveBeenCalled();
  });
});

describe("handleTvAsk: picks must be a subset of tool results", () => {
  it("keeps a pick that matches a tool result", async () => {
    const d = deps();
    const outcome = await handleTvAsk(d, textInput);
    expect(outcome.status).toBe(200);
    if (outcome.status === 200) expect(outcome.body.picks).toEqual([catalogItem()]);
  });

  it("drops a pick reference the tools never returned this turn (never invents a title)", async () => {
    const d = deps({
      runConcierge: vi.fn(async () =>
        reply({
          pickRefs: [
            { id: "tv:1", mediaType: "tv" }, // real, in toolResults
            { id: "wiki:Invented Movie", mediaType: "movie" }, // not in toolResults
          ],
        }),
      ),
    });
    const outcome = await handleTvAsk(d, textInput);
    expect(outcome.status).toBe(200);
    if (outcome.status === 200) {
      expect(outcome.body.picks).toHaveLength(1);
      expect(outcome.body.picks[0]?.id).toBe("tv:1");
    }
  });

  it("matches on id AND mediaType, not id alone", async () => {
    const d = deps({
      runConcierge: vi.fn(async () =>
        reply({
          pickRefs: [{ id: "tv:1", mediaType: "movie" }], // same id, wrong mediaType
          toolResults: [catalogItem({ id: "tv:1", mediaType: "tv" })],
        }),
      ),
    });
    const outcome = await handleTvAsk(d, textInput);
    if (outcome.status === 200) expect(outcome.body.picks).toEqual([]);
  });
});

describe("handleTvAsk: follow-up turn", () => {
  it("returns no picks when the concierge asked a follow-up, even if it also named refs", async () => {
    const d = deps({
      runConcierge: vi.fn(async () =>
        reply({ askedFollowUp: true, say: "Movie or a series?", pickRefs: [{ id: "tv:1", mediaType: "tv" }] }),
      ),
    });
    const outcome = await handleTvAsk(d, textInput);
    expect(outcome.status).toBe(200);
    if (outcome.status === 200) {
      expect(outcome.body.picks).toEqual([]);
      expect(outcome.body.askedFollowUp).toBe(true);
    }
  });
});

describe("handleTvAsk: vibe goes through the moderated path", () => {
  it("submits vibe as a moderated idea and reports whether it queued", async () => {
    const d = deps({
      runConcierge: vi.fn(async () => reply({ vibe: "a rainy neon alley" })),
      submitVibe: vi.fn(async () => ({ queued: true })),
    });
    const outcome = await handleTvAsk(d, { uid: "viewer-9", text: "put this on air" });
    expect(d.submitVibe).toHaveBeenCalledWith({ uid: "viewer-9", text: "a rainy neon alley" });
    if (outcome.status === 200) expect(outcome.body.queued).toBe(true);
  });

  it("never calls submitVibe when the concierge did not set vibe", async () => {
    const d = deps();
    await handleTvAsk(d, textInput);
    expect(d.submitVibe).not.toHaveBeenCalled();
  });

  it("reports queued:false when the moderated path refuses it", async () => {
    const d = deps({
      runConcierge: vi.fn(async () => reply({ vibe: "something" })),
      submitVibe: vi.fn(async () => ({ queued: false })),
    });
    const outcome = await handleTvAsk(d, textInput);
    if (outcome.status === 200) expect(outcome.body.queued).toBe(false);
  });
});

describe("handleTvAsk: concierge and TTS failure modes", () => {
  it("503s when the concierge agent call fails", async () => {
    const d = deps({
      runConcierge: vi.fn(async () => {
        throw new Error("nebius down");
      }),
    });
    const outcome = await handleTvAsk(d, textInput);
    expect(outcome.status).toBe(503);
  });

  it("still answers with no audioUrl when TTS fails", async () => {
    const d = deps({
      synthesise: vi.fn(async () => {
        throw new Error("slng down");
      }),
    });
    const outcome = await handleTvAsk(d, textInput);
    expect(outcome.status).toBe(200);
    if (outcome.status === 200) expect("audioUrl" in outcome.body).toBe(false);
  });

  it("meters the concierge's token usage", async () => {
    const d = deps({ runConcierge: vi.fn(async () => reply({ usage: { inputTokens: 40, outputTokens: 20 } })) });
    await handleTvAsk(d, textInput);
    expect(d.recordTokens).toHaveBeenCalledWith({ inputTokens: 40, outputTokens: 20 });
  });
});

describe("handleTvAsk: about context", () => {
  it("resolves the about reference and passes it to the concierge", async () => {
    const aboutItem = catalogItem({ id: "wiki:Alien (film)", mediaType: "movie", title: "Alien" });
    const d = deps({ detailsFor: vi.fn(async () => aboutItem) });
    await handleTvAsk(d, { uid: "u1", text: "more like this", about: { id: "wiki:Alien (film)", mediaType: "movie" } });
    expect(d.runConcierge).toHaveBeenCalledWith(expect.objectContaining({ about: aboutItem }));
  });

  it("proceeds without about context when the detail lookup fails to resolve", async () => {
    const d = deps({ detailsFor: vi.fn(async () => undefined) });
    const outcome = await handleTvAsk(d, {
      uid: "u1",
      text: "more like this",
      about: { id: "tv:999", mediaType: "tv" },
    });
    expect(outcome.status).toBe(200);
    expect(d.runConcierge).toHaveBeenCalledWith(expect.not.objectContaining({ about: expect.anything() }));
  });
});
