import { afterEach, describe, expect, it, vi } from "vitest";
import type { SteerVoiceDeps } from "./steer-voice";
import { AD_WRITE_TIMEOUT_MS, decideSteerVoice, SILENT_VOICE } from "./steer-voice";

function deps(overrides: Partial<SteerVoiceDeps> = {}): SteerVoiceDeps {
  return {
    writeAdRead: async () => ({
      line: "A word from Ana. Croak Stand: lemonade, ribbited.",
      usage: { inputTokens: 20, outputTokens: 12 },
    }),
    synthesise: async (clipId) => clipId,
    ...overrides,
  };
}

const idea = { id: 7, name: "Ana", text: "an ad for my lemonade stand" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("decideSteerVoice", () => {
  it("steers silent with no writer or TTS call when the idea does not ask for an ad", async () => {
    const writeAdRead = vi.fn();
    const synthesise = vi.fn();
    const result = await decideSteerVoice(deps({ writeAdRead, synthesise }), {
      ...idea,
      text: "a capybara quietly runs a laundrette",
    });
    expect(result).toEqual(SILENT_VOICE);
    expect(writeAdRead).not.toHaveBeenCalled();
    expect(synthesise).not.toHaveBeenCalled();
  });

  it("writes and synthesises an ad read, returning its clip url and usage", async () => {
    const result = await decideSteerVoice(deps(), idea);
    expect(result).toEqual({
      usage: { inputTokens: 20, outputTokens: 12 },
      clipId: "steer-7",
      url: "announcer/steer-7",
    });
  });

  it("steers silent, without affecting the steer, when the ad write fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await decideSteerVoice(
      deps({
        writeAdRead: async () => {
          throw new Error("nebius down");
        },
      }),
      idea,
    );
    expect(result).toEqual(SILENT_VOICE);
  });

  it("steers silent rather than hold the steer for a hung ad write", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending = decideSteerVoice(
      deps({ writeAdRead: () => new Promise(() => {}) }),
      idea,
    );
    await vi.advanceTimersByTimeAsync(AD_WRITE_TIMEOUT_MS);
    expect(await pending).toEqual(SILENT_VOICE);
  });

  it("keeps the write's real cost but drops the clip when TTS fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await decideSteerVoice(
      deps({
        synthesise: async () => {
          throw new Error("slng 429");
        },
      }),
      idea,
    );
    expect(result).toEqual({
      usage: { inputTokens: 20, outputTokens: 12 },
      clipId: undefined,
      url: undefined,
    });
  });
});
