import { describe, expect, it, vi } from "vitest";
import {
  extractTelegramPhoto,
  handlePhotoSubmission,
  selectPhotoSize,
  sniffImageMime,
  telegramPhotoIntake,
  TICKER_ACCEPTED_REPLY,
} from "./ticker-intake";
import type { PhotoIntakeDeps, PhotoIntakeInput, TelegramMessageLike } from "./ticker-intake";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2,
]);

describe("selectPhotoSize", () => {
  it("picks the smallest size whose shorter side is at least 240px", () => {
    const sizes = [
      { fileId: "tiny", width: 90, height: 90 },
      { fileId: "small", width: 320, height: 240 },
      { fileId: "large", width: 1280, height: 960 },
    ];
    expect(selectPhotoSize(sizes)?.fileId).toBe("small");
  });

  it("never returns the largest when a smaller qualifying size exists", () => {
    const sizes = [
      { fileId: "medium", width: 400, height: 300 },
      { fileId: "large", width: 1280, height: 960 },
    ];
    expect(selectPhotoSize(sizes)?.fileId).toBe("medium");
  });

  it("returns undefined when every size is under the threshold", () => {
    const sizes = [{ fileId: "tiny", width: 100, height: 80 }];
    expect(selectPhotoSize(sizes)).toBeUndefined();
  });
});

describe("sniffImageMime", () => {
  it("recognizes JPEG, PNG and WEBP by magic bytes", () => {
    expect(sniffImageMime(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffImageMime(PNG_BYTES)).toBe("image/png");
    expect(sniffImageMime(WEBP_BYTES)).toBe("image/webp");
  });

  it("refuses anything else, including a renamed non-image file", () => {
    const fakeJpeg = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]); // %PDF magic bytes
    expect(sniffImageMime(fakeJpeg)).toBeUndefined();
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe("extractTelegramPhoto", () => {
  it("reads sizes and caption from a raw photo message", () => {
    const raw = {
      photo: [{ file_id: "a", width: 90, height: 90 }],
      caption: "cute",
    };
    expect(extractTelegramPhoto(raw)).toEqual({
      sizes: [{ fileId: "a", width: 90, height: 90 }],
      caption: "cute",
    });
  });

  it("returns undefined for a text message with no photo", () => {
    expect(extractTelegramPhoto({ text: "hello" })).toBeUndefined();
    expect(extractTelegramPhoto(undefined)).toBeUndefined();
    expect(extractTelegramPhoto({ photo: [] })).toBeUndefined();
  });

  it("reports no caption when none was sent", () => {
    const raw = { photo: [{ file_id: "a", width: 90, height: 90 }] };
    expect(extractTelegramPhoto(raw)?.caption).toBeUndefined();
  });
});

describe("telegramPhotoIntake", () => {
  function message(overrides: Partial<TelegramMessageLike> = {}): TelegramMessageLike {
    return {
      raw: { photo: [{ file_id: "f1", width: 300, height: 300 }], caption: "hi" },
      author: { userId: "555", userName: "Ana" },
      ...overrides,
    };
  }

  it("derives uid as telegram:<userId> from the message author, never from message text", () => {
    const intake = telegramPhotoIntake(message());
    expect(intake?.uid).toBe("telegram:555");
    expect(intake?.name).toBe("Ana");
    expect(intake?.caption).toBe("hi");
  });

  it("ignores whatever uid-shaped text is inside the caption", () => {
    const raw = { photo: [{ file_id: "f1", width: 300, height: 300 }], caption: "telegram:999" };
    const intake = telegramPhotoIntake(message({ raw }));
    expect(intake?.uid).toBe("telegram:555"); // still the real author, not the caption text
  });

  it("returns undefined for a text-only message", () => {
    expect(telegramPhotoIntake(message({ raw: { text: "hello" } }))).toBeUndefined();
  });

  it("falls back to 'a viewer' for a blank author name", () => {
    const intake = telegramPhotoIntake(message({ author: { userId: "1", userName: "   " } }));
    expect(intake?.name).toBe("a viewer");
  });
});

describe("handlePhotoSubmission", () => {
  function deps(overrides: Partial<PhotoIntakeDeps> = {}): PhotoIntakeDeps {
    return {
      cooldownSeconds: vi.fn(() => 0),
      downloadPhoto: vi.fn(async () => JPEG_BYTES),
      moderateImage: vi.fn(async () => ({
        verdict: { ok: true, reason: "" },
        usage: ZERO_USAGE,
        ms: 5,
      })),
      moderateText: vi.fn(async () => ({ verdict: { ok: true, reason: "" }, usage: ZERO_USAGE })),
      addItem: vi.fn((input) => ({ id: 1, addedAt: 0, ...input, caption: input.caption })),
      recordTicker: vi.fn(),
      ...overrides,
    };
  }

  function input(overrides: Partial<PhotoIntakeInput> = {}): PhotoIntakeInput {
    return {
      uid: "telegram:1",
      name: "Ana",
      caption: "a nice sunset",
      sizes: [{ fileId: "f1", width: 320, height: 240 }],
      ...overrides,
    };
  }

  it("accepts a good photo and stores it on the ticker", async () => {
    const d = deps();
    const result = await handlePhotoSubmission(d, input());
    expect(result).toEqual({ accepted: true, reply: TICKER_ACCEPTED_REPLY });
    expect(d.addItem).toHaveBeenCalledWith({
      uid: "telegram:1",
      name: "Ana",
      caption: "a nice sunset",
      mime: "image/jpeg",
      bytes: JPEG_BYTES,
    });
  });

  it("refuses on cooldown before touching the network, and reports seconds left", async () => {
    const d = deps({ cooldownSeconds: vi.fn(() => 42) });
    const result = await handlePhotoSubmission(d, input());
    expect(result).toEqual({ accepted: false, reply: "One photo per minute on the ticker: 42s left." });
    expect(d.downloadPhoto).not.toHaveBeenCalled();
    expect(d.moderateImage).not.toHaveBeenCalled();
    expect(d.addItem).not.toHaveBeenCalled();
  });

  it("refuses when every offered size is too small", async () => {
    const d = deps();
    const tiny = [{ fileId: "x", width: 80, height: 80 }];
    const result = await handlePhotoSubmission(d, input({ sizes: tiny }));
    expect(result.accepted).toBe(false);
    expect(d.downloadPhoto).not.toHaveBeenCalled();
  });

  it("refuses a download over 1 MB", async () => {
    const big = new Uint8Array(1_000_001);
    big.set([0xff, 0xd8, 0xff]);
    const d = deps({ downloadPhoto: vi.fn(async () => big) });
    const result = await handlePhotoSubmission(d, input());
    expect(result.accepted).toBe(false);
    expect(result.reply).toMatch(/too big/i);
    expect(d.moderateImage).not.toHaveBeenCalled();
  });

  it("refuses a file whose magic bytes are not a supported image type", async () => {
    const d = deps({ downloadPhoto: vi.fn(async () => new Uint8Array([1, 2, 3, 4])) });
    const result = await handlePhotoSubmission(d, input());
    expect(result.accepted).toBe(false);
    expect(result.reply).toMatch(/jpeg, png or webp/i);
    expect(d.moderateImage).not.toHaveBeenCalled();
  });

  it("refuses when vision moderation says no, and meters the call", async () => {
    const usage = { inputTokens: 50, outputTokens: 10 };
    const verdict = { ok: false, reason: "no QR codes" };
    const d = deps({ moderateImage: vi.fn(async () => ({ verdict, usage, ms: 10 })) });
    const result = await handlePhotoSubmission(d, input());
    expect(result).toEqual({ accepted: false, reply: "no QR codes" });
    expect(d.recordTicker).toHaveBeenCalledWith(usage);
    expect(d.moderateText).not.toHaveBeenCalled();
    expect(d.addItem).not.toHaveBeenCalled();
  });

  it("fails closed when vision moderation errors or times out", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const timedOut = () => Promise.reject(new Error("timed out after 8000ms"));
    const d = deps({ moderateImage: vi.fn(timedOut) });
    const result = await handlePhotoSubmission(d, input());
    expect(result).toEqual({ accepted: false, reply: "couldn't check that image, try again" });
    expect(d.addItem).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refuses when the caption/name moderator says no, and meters that call too", async () => {
    const usage = { inputTokens: 5, outputTokens: 5 };
    const d = deps({
      moderateText: vi.fn(async () => ({ verdict: { ok: false, reason: "no real names" }, usage })),
    });
    const result = await handlePhotoSubmission(d, input());
    expect(result).toEqual({ accepted: false, reply: "no real names" });
    expect(d.recordTicker).toHaveBeenCalledWith(usage);
    expect(d.addItem).not.toHaveBeenCalled();
  });

  it("moderates a placeholder in place of a missing caption, and stores no caption", async () => {
    const d = deps();
    await handlePhotoSubmission(d, input({ caption: undefined }));
    expect(d.moderateText).toHaveBeenCalledWith("a shared photo", "Ana");
    expect(d.addItem).toHaveBeenCalledWith(expect.objectContaining({ caption: undefined }));
  });

  it("truncates an overlong caption to 60 characters", async () => {
    const d = deps();
    const long = "x".repeat(90);
    await handlePhotoSubmission(d, input({ caption: long }));
    expect(d.addItem).toHaveBeenCalledWith(expect.objectContaining({ caption: "x".repeat(60) }));
  });

  it("passes the submitter's uid straight through on every accepted submission", async () => {
    // The store itself (ticker.ts) owns the per-user replace rule — see ticker.test.ts — this
    // just confirms the pipeline forwards uid unchanged, twice in a row for the same user.
    const d = deps();
    await handlePhotoSubmission(d, input({ uid: "telegram:9" }));
    await handlePhotoSubmission(d, input({ uid: "telegram:9", caption: "second" }));
    expect(d.addItem).toHaveBeenCalledTimes(2);
    const last = { uid: "telegram:9", caption: "second" };
    expect(d.addItem).toHaveBeenLastCalledWith(expect.objectContaining(last));
  });
});
