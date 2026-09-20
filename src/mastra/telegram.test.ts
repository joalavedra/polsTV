import { describe, expect, it, vi } from "vitest";
import type { AddResult, Scene } from "./channel";
import { STEER_GAP_MS } from "./channel";
import { PITCH_MIN_KARMA } from "./pitch";
import {
  displayName,
  myStatsLogic,
  pitchToolResult,
  requireTelegramUid,
  routeDirectMessage,
  SceneHistory,
  sceneChangeMessages,
  sendDM,
  submitIdeaLogic,
  whatsOnLogic,
} from "./telegram";
import type {
  DirectMessageDeps,
  DirectMessageLike,
  DMSender,
  MyStatsDeps,
  SubmitIdeaDeps,
  SubmitIdeaResult,
} from "./telegram";
import { TICKER_ACCEPTED_REPLY } from "./ticker-intake";
import type { PhotoIntakeDeps } from "./ticker-intake";
import { VOICE_NOT_HEARD_REPLY, VOICE_TOO_LONG_REPLY } from "./voice-intake";
import type { VoiceIntakeDeps } from "./voice-intake";

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    ideaId: 1,
    uid: "telegram:1",
    name: "Ana",
    text: "a cat",
    prompt: "p",
    airedAt: 0,
    likes: 0,
    amends: [],
    ...overrides,
  };
}

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

describe("submitIdeaLogic", () => {
  function deps(overrides: Partial<SubmitIdeaDeps> = {}): SubmitIdeaDeps {
    return {
      moderate: vi.fn(async () => ({ verdict: { ok: true, reason: "" }, usage: ZERO_USAGE })),
      addIdea: vi.fn(
        (): AddResult => ({
          ok: true,
          idea: {
            id: 1,
            uid: "telegram:1",
            name: "Ana",
            text: "x",
            source: "telegram",
            at: 0,
            kind: "new",
          },
        }),
      ),
      queuePosition: vi.fn(() => 1),
      recordModeration: vi.fn(),
      ...overrides,
    };
  }

  it("queues an approved idea and reports position and wait", async () => {
    const d = deps({ queuePosition: vi.fn(() => 2) });
    const result = await submitIdeaLogic(d, "telegram:1", "Ana", "a cat riding a bike");
    expect(result).toEqual({ queued: true, position: 2, waitSeconds: 2 * (STEER_GAP_MS / 1000) });
    expect(d.addIdea).toHaveBeenCalledWith({
      uid: "telegram:1",
      name: "Ana",
      text: "a cat riding a bike",
      source: "telegram",
      kind: "new",
    });
  });

  it("queues an amend with kind: amend when the caller asked to change the scene on air", async () => {
    const d = deps();
    await submitIdeaLogic(d, "telegram:1", "Ana", "add a hat", "amend");
    expect(d.addIdea).toHaveBeenCalledWith({
      uid: "telegram:1",
      name: "Ana",
      text: "add a hat",
      source: "telegram",
      kind: "amend",
    });
  });

  it("meters an approved idea's moderation cost against its queued idea id", async () => {
    const d = deps();
    await submitIdeaLogic(d, "telegram:1", "Ana", "a cat");
    expect(d.recordModeration).toHaveBeenCalledWith(1, "Ana", "x", ZERO_USAGE);
  });

  it("reports the moderator's reason when an idea is rejected", async () => {
    const usage = { inputTokens: 12, outputTokens: 3 };
    const verdict = { ok: false, reason: "no real people" };
    const d = deps({ moderate: vi.fn(async () => ({ verdict, usage })) });
    const result = await submitIdeaLogic(d, "telegram:1", "Ana", "a real celebrity");
    expect(result).toEqual({ queued: false, reason: "no real people" });
    expect(d.addIdea).not.toHaveBeenCalled();
    expect(d.recordModeration).toHaveBeenCalledWith("rejected", "Ana", "a real celebrity", usage);
  });

  it("reports the channel's reason when the user already has a queued idea", async () => {
    const alreadyQueued = "You already have an idea in the queue. Wait until it airs.";
    const d = deps({ addIdea: vi.fn((): AddResult => ({ ok: false, reason: alreadyQueued })) });
    let result: SubmitIdeaResult;
    try {
      // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
      result = await submitIdeaLogic(d, "telegram:1", "Ana", "a second idea");
    } catch (error) {
      throw new Error("submitIdeaLogic rejected; it must resolve to an outcome here", {
        cause: error,
      });
    }
    expect(result).toEqual({ queued: false, reason: alreadyQueued });
    expect(d.recordModeration).toHaveBeenCalledWith("rejected", "Ana", "a second idea", ZERO_USAGE);
  });

  it("fails closed with a friendly reason when moderation throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps({ moderate: vi.fn(async () => Promise.reject(new Error("nebius is down"))) });
    const result = await submitIdeaLogic(d, "telegram:1", "Ana", "a cat");
    expect(result.queued).toBe(false);
    expect(result.reason).toMatch(/unavailable/i);
    expect(consoleError).toHaveBeenCalled();
    expect(d.recordModeration).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("requireTelegramUid", () => {
  it("accepts a telegram: resourceId", () => {
    expect(requireTelegramUid("telegram:123")).toBe("telegram:123");
  });

  it("throws when the resourceId is missing", () => {
    expect(() => requireTelegramUid(undefined)).toThrow(/resourceId/);
  });

  it("throws when the resourceId is not from telegram", () => {
    expect(() => requireTelegramUid("web:123")).toThrow(/resourceId/);
  });
});

describe("displayName", () => {
  it("uses the channel context's userName, capped at 24 chars", () => {
    expect(displayName({ userName: "Ana" })).toBe("Ana");
    expect(displayName({ userName: "a".repeat(40) })).toBe("a".repeat(24));
  });

  it("falls back when there is no channel context or an empty name", () => {
    expect(displayName(undefined)).toBe("a viewer");
    expect(displayName({ userName: "   " })).toBe("a viewer");
  });
});

describe("whatsOnLogic", () => {
  it("reports null onAir/steering when the channel is idle", () => {
    const result = whatsOnLogic(
      { live: false, viewers: 0, now: null, steering: null, queue: [], chat: [], rank: [], ts: 0 },
      "https://watch.example",
    );
    expect(result).toEqual({
      onAir: null,
      steering: null,
      queueLength: 0,
      viewers: 0,
      watchLink: "https://watch.example",
    });
  });

  it("reports the aired scene, steering idea, queue length and viewers", () => {
    const result = whatsOnLogic(
      {
        live: true,
        viewers: 5,
        now: { ...scene({ name: "Ana", text: "a cat", likes: 3 }), karma: 3 },
        steering: { name: "Bob", text: "a dog", kind: "new" },
        queue: [{ id: 2, name: "Carol", text: "a bird", karma: 1, kind: "new" }],
        chat: [],
        rank: [],
        ts: 0,
      },
      "https://watch.example",
    );
    expect(result.onAir).toEqual({ by: "Ana", text: "a cat", likes: 3 });
    expect(result.steering).toEqual({ by: "Bob", text: "a dog" });
    expect(result.queueLength).toBe(1);
    expect(result.viewers).toBe(5);
  });
});

describe("myStatsLogic", () => {
  function deps(overrides: Partial<MyStatsDeps> = {}): MyStatsDeps {
    return {
      karmaOf: vi.fn(() => 0),
      myIdea: vi.fn(() => undefined),
      queuePosition: vi.fn(() => undefined),
      isOnAir: vi.fn(() => false),
      recentScenes: vi.fn(() => []),
      ...overrides,
    };
  }

  it("reports karma, no queued idea, and no recent scenes", () => {
    const result = myStatsLogic("telegram:1", deps({ karmaOf: vi.fn(() => 5) }));
    expect(result).toEqual({
      karma: 5,
      queued: null,
      onAirNow: false,
      recentScenes: [],
      pitchUnlocked: true,
    });
  });

  it("says the pitch is locked below the karma gate and unlocked at it", () => {
    const at = (karma: number) => myStatsLogic("telegram:1", deps({ karmaOf: () => karma }));
    expect(at(PITCH_MIN_KARMA - 1).pitchUnlocked).toBe(false);
    expect(at(PITCH_MIN_KARMA).pitchUnlocked).toBe(true);
  });

  it("reports the caller's queued idea with its position", () => {
    const idea = {
      id: 1,
      uid: "telegram:1",
      name: "Ana",
      text: "a cat",
      source: "telegram" as const,
      at: 0,
      kind: "new" as const,
    };
    const d = deps({ myIdea: vi.fn(() => idea), queuePosition: vi.fn(() => 3) });
    const result = myStatsLogic("telegram:1", d);
    expect(result.queued).toEqual({ text: "a cat", position: 3 });
  });

  it("reports recent aired scenes with their like counts", () => {
    const scenes = [scene({ text: "a cat", likes: 4 }), scene({ text: "a dog", likes: 0 })];
    const d = deps({ recentScenes: vi.fn(() => scenes), isOnAir: vi.fn(() => true) });
    const result = myStatsLogic("telegram:1", d);
    expect(result.onAirNow).toBe(true);
    expect(result.recentScenes).toEqual([
      { text: "a cat", likes: 4 },
      { text: "a dog", likes: 0 },
    ]);
  });
});

describe("SceneHistory", () => {
  it("returns the most recently recorded scene first, capped at `keep`", () => {
    const history = new SceneHistory(2);
    history.record(scene({ text: "one" }));
    history.record(scene({ text: "two" }));
    history.record(scene({ text: "three" }));
    expect(history.recentOf("telegram:1").map((s) => s.text)).toEqual(["three", "two"]);
  });

  it("keeps each user's history separate", () => {
    const history = new SceneHistory();
    history.record(scene({ uid: "telegram:1", text: "ana's scene" }));
    history.record(scene({ uid: "telegram:2", text: "bob's scene" }));
    expect(history.recentOf("telegram:1")).toHaveLength(1);
    expect(history.recentOf("telegram:3")).toEqual([]);
  });
});

describe("sceneChangeMessages", () => {
  it("DMs the new prompter and skips a like message when nothing ended", () => {
    const change = { onAir: scene({ uid: "telegram:1" }), ended: undefined, amended: false };
    const jobs = sceneChangeMessages(change, "https://watch");
    expect(jobs).toEqual([
      { uid: "telegram:1", text: "You're on air now! Watch polsTV: https://watch" },
    ]);
  });

  it("skips the 'you're on air' DM when the scene on air was only amended, not new", () => {
    const change = { onAir: scene({ uid: "telegram:1" }), ended: undefined, amended: true };
    const jobs = sceneChangeMessages(change, "https://watch");
    expect(jobs).toEqual([]);
  });

  it("adds a like message only when the ended scene earned at least one like", () => {
    const zeroLikes = sceneChangeMessages(
      { onAir: undefined, ended: scene({ uid: "telegram:2", likes: 0 }), amended: false },
      "https://watch",
    );
    expect(zeroLikes).toEqual([]);

    const withLikes = sceneChangeMessages(
      { onAir: undefined, ended: scene({ uid: "telegram:2", likes: 3 }), amended: false },
      "https://watch",
    );
    expect(withLikes).toEqual([{ uid: "telegram:2", text: "Your scene got 3 likes (+3 karma)" }]);
  });

  it("uses singular 'like' for exactly one like", () => {
    const change = { onAir: undefined, ended: scene({ likes: 1 }), amended: false };
    const jobs = sceneChangeMessages(change, "https://watch");
    expect(jobs[0]?.text).toContain("1 like (");
  });
});

describe("sendDM", () => {
  function sender(overrides: Partial<DMSender> = {}): DMSender {
    return {
      native: vi.fn(async () => undefined),
      fallback: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it("skips non-telegram uids entirely", async () => {
    const s = sender();
    await sendDM("web:abc123", "hi", s);
    expect(s.native).not.toHaveBeenCalled();
    expect(s.fallback).not.toHaveBeenCalled();
  });

  it("uses the native route and skips the fallback when it succeeds", async () => {
    const s = sender();
    await sendDM("telegram:1", "hi", s);
    expect(s.native).toHaveBeenCalledWith("1", "hi");
    expect(s.fallback).not.toHaveBeenCalled();
  });

  it("falls back when the native route fails", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const s = sender({ native: vi.fn(async () => Promise.reject(new Error("no channel"))) });
    await sendDM("telegram:1", "hi", s);
    expect(s.fallback).toHaveBeenCalledWith("1", "hi");
    consoleWarn.mockRestore();
  });

  it("never throws even when both routes fail", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = sender({
      native: vi.fn(async () => Promise.reject(new Error("no channel"))),
      fallback: vi.fn(async () => Promise.reject(new Error("network down"))),
    });
    await expect(sendDM("telegram:1", "hi", s)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});

describe("pitchToolResult", () => {
  it("hands the agent the ad read the voice will speak", () => {
    expect(pitchToolResult({ ok: true, line: "A word from Ana. Buy nothing." }, 4)).toEqual({
      onAir: true,
      line: "A word from Ana. Buy nothing.",
    });
  });

  it("says how much karma is still missing when the gate refuses", () => {
    const result = pitchToolResult({ ok: false, code: "karma", reason: "needs 3" }, 1);
    expect(result).toEqual({ onAir: false, reason: "needs 3", karmaNeeded: PITCH_MIN_KARMA - 1 });
  });

  it("passes any other refusal straight through without a karma hint", () => {
    const result = pitchToolResult({ ok: false, code: "busy", reason: "Bob has the slot" }, 9);
    expect(result).toEqual({ onAir: false, reason: "Bob has the slot" });
  });
});

describe("routeDirectMessage", () => {
  const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

  function thread() {
    return { post: vi.fn(async (_text: string) => undefined) };
  }

  /** Typed so it structurally matches routeDirectMessage's generic defaultHandler parameter —
   * vi.fn's inferred Mock type only satisfies a plain function type when its own implementation
   * declares the same parameter count. */
  function fakeDefaultHandler(): (thread: unknown, message: unknown) => Promise<void> {
    return vi.fn(async (_thread: unknown, _message: unknown) => undefined);
  }

  function directMessage(overrides: Partial<DirectMessageLike> = {}): DirectMessageLike {
    return {
      text: "",
      raw: {},
      attachments: ["original-attachment"],
      author: { userId: "555", userName: "Ana" },
      ...overrides,
    };
  }

  function photoDeps(overrides: Partial<PhotoIntakeDeps> = {}): PhotoIntakeDeps {
    return {
      cooldownSeconds: () => 0,
      downloadPhoto: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff])),
      moderateImage: vi.fn(async () => ({
        verdict: { ok: true, reason: "" },
        usage: ZERO_USAGE,
        ms: 1,
      })),
      moderateText: vi.fn(async () => ({ verdict: { ok: true, reason: "" }, usage: ZERO_USAGE })),
      addItem: vi.fn((input) => ({ id: 1, addedAt: 0, ...input, caption: input.caption })),
      recordTicker: vi.fn(),
      ...overrides,
    };
  }

  function voiceDeps(overrides: Partial<VoiceIntakeDeps> = {}): VoiceIntakeDeps {
    return {
      downloadAudio: vi.fn(async () => new Uint8Array([1, 2, 3])),
      transcribe: vi.fn(async () => ({ text: "a dancing capybara", audioSeconds: 3 })),
      recordStt: vi.fn(),
      ...overrides,
    };
  }

  function deps(overrides: Partial<DirectMessageDeps> = {}): DirectMessageDeps {
    return { photo: photoDeps(), voice: voiceDeps(), ...overrides };
  }

  it("leaves a normal text message untouched and routes it to the default handler", async () => {
    const t = thread();
    const msg = directMessage({ text: "hello there" });
    const defaultHandler = fakeDefaultHandler();
    const d = deps();
    await routeDirectMessage(d, t, msg, defaultHandler);
    expect(defaultHandler).toHaveBeenCalledWith(t, msg);
    expect(msg.text).toBe("hello there");
    expect(t.post).not.toHaveBeenCalled();
    expect(d.voice.transcribe).not.toHaveBeenCalled();
    expect(d.photo.moderateImage).not.toHaveBeenCalled();
  });

  it("leaves a video_note message untouched, same as any other unhandled attachment", async () => {
    const t = thread();
    const msg = directMessage({ raw: { video_note: { file_id: "v1", duration: 3 } } });
    const defaultHandler = fakeDefaultHandler();
    await routeDirectMessage(deps(), t, msg, defaultHandler);
    expect(defaultHandler).toHaveBeenCalledWith(t, msg);
    expect(t.post).not.toHaveBeenCalled();
  });

  it("routes a photo to the ticker pipeline and never reaches the default handler", async () => {
    const t = thread();
    const msg = directMessage({ raw: { photo: [{ file_id: "p1", width: 300, height: 300 }] } });
    const defaultHandler = fakeDefaultHandler();
    await routeDirectMessage(deps(), t, msg, defaultHandler);
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(t.post).toHaveBeenCalledWith(TICKER_ACCEPTED_REPLY);
  });

  it("hands a heard transcript to the default handler as the trusted author's msg", async () => {
    const t = thread();
    const msg = directMessage({
      raw: { voice: { file_id: "f1", duration: 4, mime_type: "audio/ogg", file_size: 5_000 } },
      author: { userId: "555", userName: "Ana" },
    });
    const defaultHandler = fakeDefaultHandler();
    await routeDirectMessage(deps(), t, msg, defaultHandler);

    expect(t.post).toHaveBeenCalledWith('Heard: "a dancing capybara"');
    expect(defaultHandler).toHaveBeenCalledWith(t, msg);
    // Same instance handed to defaultHandler, so id/threadId/author (and the trusted
    // `telegram:<userId>` resourceId derived from it) are exactly what a typed message would carry.
    expect(msg.text).toBe("a dancing capybara");
    expect(msg.author.userId).toBe("555");
    expect(msg.attachments).toEqual([]);
  });

  it("meters the STT cost for a heard voice note", async () => {
    const t = thread();
    const msg = directMessage({
      raw: { voice: { file_id: "f1", duration: 4, file_size: 5_000 } },
    });
    const d = deps();
    await routeDirectMessage(d, t, msg, fakeDefaultHandler());
    expect(d.voice.recordStt).toHaveBeenCalledWith("Ana", "a dancing capybara", 3);
  });

  it("refuses an over-long voice note and never reaches the default handler", async () => {
    const t = thread();
    const msg = directMessage({
      raw: { voice: { file_id: "f1", duration: 31, file_size: 5_000 } },
    });
    const defaultHandler = fakeDefaultHandler();
    const d = deps();
    await routeDirectMessage(d, t, msg, defaultHandler);
    expect(t.post).toHaveBeenCalledWith(VOICE_TOO_LONG_REPLY);
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(msg.text).toBe("");
    expect(d.voice.downloadAudio).not.toHaveBeenCalled();
  });

  it("refuses an oversized voice note and never reaches the default handler", async () => {
    const t = thread();
    const msg = directMessage({
      raw: { voice: { file_id: "f1", duration: 4, file_size: 1_500_001 } },
    });
    const defaultHandler = fakeDefaultHandler();
    await routeDirectMessage(deps(), t, msg, defaultHandler);
    expect(t.post).toHaveBeenCalledWith(VOICE_TOO_LONG_REPLY);
    expect(defaultHandler).not.toHaveBeenCalled();
  });

  it("reports an unintelligible voice note and never reaches the default handler", async () => {
    const t = thread();
    const msg = directMessage({
      raw: { voice: { file_id: "f1", duration: 2, file_size: 5_000 } },
    });
    const defaultHandler = fakeDefaultHandler();
    const d = deps({
      voice: voiceDeps({ transcribe: vi.fn(async () => ({ text: "  ", audioSeconds: 1 })) }),
    });
    await routeDirectMessage(d, t, msg, defaultHandler);
    expect(t.post).toHaveBeenCalledWith(VOICE_NOT_HEARD_REPLY);
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(msg.text).toBe("");
  });

  it("fails closed with a friendly reply when transcription throws, never hands off", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = thread();
    const msg = directMessage({
      raw: { voice: { file_id: "f1", duration: 4, file_size: 5_000 } },
    });
    const defaultHandler = fakeDefaultHandler();
    const d = deps({
      voice: voiceDeps({ transcribe: vi.fn(async () => Promise.reject(new Error("slng down"))) }),
    });
    await routeDirectMessage(d, t, msg, defaultHandler);
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(msg.text).toBe("");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fails closed with a friendly reply when the download throws, never hands off", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = thread();
    const msg = directMessage({
      raw: { voice: { file_id: "f1", duration: 4, file_size: 5_000 } },
    });
    const defaultHandler = fakeDefaultHandler();
    const d = deps({
      voice: voiceDeps({ downloadAudio: vi.fn(async () => Promise.reject(new Error("no file"))) }),
    });
    try {
      // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
      await routeDirectMessage(d, t, msg, defaultHandler);
    } catch (error) {
      throw new Error("routeDirectMessage rejected; it must resolve to an outcome here", {
        cause: error,
      });
    }
    expect(defaultHandler).not.toHaveBeenCalled();
    expect(d.voice.transcribe).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
