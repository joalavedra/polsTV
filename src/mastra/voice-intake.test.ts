import { describe, expect, it, vi } from "vitest";
import {
  extractTelegramVoice,
  handleVoiceMessage,
  VOICE_NOT_HEARD_REPLY,
  VOICE_TOO_LONG_REPLY,
  VOICE_TRANSCRIBE_FAILED_REPLY,
} from "./voice-intake";
import type { VoiceIntake, VoiceIntakeDeps } from "./voice-intake";

const AUDIO_BYTES = new Uint8Array([1, 2, 3]);

describe("extractTelegramVoice", () => {
  it("reads a voice note's file id, duration, size and mime type", () => {
    const raw = { voice: { file_id: "f1", duration: 4, mime_type: "audio/ogg", file_size: 5_000 } };
    expect(extractTelegramVoice(raw)).toEqual({
      fileId: "f1",
      durationSeconds: 4,
      sizeBytes: 5_000,
      mimeType: "audio/ogg",
    });
  });

  it("reads an uploaded audio file the same way", () => {
    const raw = {
      audio: { file_id: "a1", duration: 10, mime_type: "audio/mpeg", file_size: 9_000 },
    };
    expect(extractTelegramVoice(raw)?.fileId).toBe("a1");
  });

  it("defaults the mime type to audio/ogg when Telegram omits it", () => {
    const raw = { voice: { file_id: "f1" } };
    expect(extractTelegramVoice(raw)?.mimeType).toBe("audio/ogg");
  });

  it("returns undefined for a text message, a photo message, or a video_note", () => {
    expect(extractTelegramVoice({ text: "hello" })).toBeUndefined();
    expect(extractTelegramVoice({ photo: [{ file_id: "p1" }] })).toBeUndefined();
    expect(extractTelegramVoice({ video_note: { file_id: "v1", duration: 3 } })).toBeUndefined();
    expect(extractTelegramVoice(undefined)).toBeUndefined();
  });
});

describe("handleVoiceMessage", () => {
  function deps(overrides: Partial<VoiceIntakeDeps> = {}): VoiceIntakeDeps {
    return {
      downloadAudio: vi.fn(async () => AUDIO_BYTES),
      transcribe: vi.fn(async () => ({ text: "a dancing capybara", audioSeconds: 3 })),
      recordStt: vi.fn(),
      ...overrides,
    };
  }

  function intake(overrides: Partial<VoiceIntake> = {}): VoiceIntake {
    return {
      fileId: "f1",
      durationSeconds: 5,
      sizeBytes: 10_000,
      mimeType: "audio/ogg",
      ...overrides,
    };
  }

  it("transcribes a good voice note and hands back the heard transcript", async () => {
    const d = deps();
    const result = await handleVoiceMessage(d, "Ana", intake());
    expect(result).toEqual({
      kind: "heard",
      reply: 'Heard: "a dancing capybara"',
      transcript: "a dancing capybara",
    });
    expect(d.downloadAudio).toHaveBeenCalledWith("f1");
    expect(d.transcribe).toHaveBeenCalledWith(AUDIO_BYTES, "audio/ogg");
  });

  it("meters the SLNG STT cost for a heard transcript", async () => {
    const d = deps();
    await handleVoiceMessage(d, "Ana", intake());
    expect(d.recordStt).toHaveBeenCalledWith("Ana", "a dancing capybara", 3);
  });

  it("refuses a voice note over 30 seconds without downloading or transcribing", async () => {
    const d = deps();
    const result = await handleVoiceMessage(d, "Ana", intake({ durationSeconds: 31 }));
    expect(result).toEqual({ kind: "too-long", reply: VOICE_TOO_LONG_REPLY });
    expect(d.downloadAudio).not.toHaveBeenCalled();
    expect(d.transcribe).not.toHaveBeenCalled();
  });

  it("refuses a voice note over 1.5 MB without downloading or transcribing", async () => {
    const d = deps();
    const result = await handleVoiceMessage(d, "Ana", intake({ sizeBytes: 1_500_001 }));
    expect(result).toEqual({ kind: "too-long", reply: VOICE_TOO_LONG_REPLY });
    expect(d.downloadAudio).not.toHaveBeenCalled();
  });

  it("treats a missing duration or size as passing that guard", async () => {
    const d = deps();
    const result = await handleVoiceMessage(
      d,
      "Ana",
      intake({ durationSeconds: undefined, sizeBytes: undefined }),
    );
    expect(result.kind).toBe("heard");
  });

  it("reports an empty transcript as not heard, but still meters it", async () => {
    const d = deps({ transcribe: vi.fn(async () => ({ text: "", audioSeconds: 2 })) });
    const result = await handleVoiceMessage(d, "Ana", intake());
    expect(result).toEqual({ kind: "not-heard", reply: VOICE_NOT_HEARD_REPLY });
    expect(d.recordStt).toHaveBeenCalledWith("Ana", "", 2);
  });

  it("reports a transcript under 3 characters as not heard", async () => {
    const d = deps({ transcribe: vi.fn(async () => ({ text: "hi", audioSeconds: 1 })) });
    const result = await handleVoiceMessage(d, "Ana", intake());
    expect(result.kind).toBe("not-heard");
  });

  it("does not meter a transcript when SLNG reports no audio duration", async () => {
    const d = deps({ transcribe: vi.fn(async () => ({ text: "a cat" })) });
    await handleVoiceMessage(d, "Ana", intake());
    expect(d.recordStt).not.toHaveBeenCalled();
  });

  it("fails closed with a friendly reply when transcription throws, and logs it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps({ transcribe: vi.fn(async () => Promise.reject(new Error("slng is down"))) });
    const result = await handleVoiceMessage(d, "Ana", intake());
    expect(result).toEqual({ kind: "transcribe-failed", reply: VOICE_TRANSCRIBE_FAILED_REPLY });
    expect(d.recordStt).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Ana"), expect.any(Error));
    consoleError.mockRestore();
  });

  it("fails closed with a friendly reply when the download throws, and logs it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingDownload = vi.fn(async () => Promise.reject(new Error("getFile failed")));
    const d = deps({ downloadAudio: failingDownload });
    const result = await handleVoiceMessage(d, "Ana", intake());
    expect(result).toEqual({ kind: "transcribe-failed", reply: VOICE_TRANSCRIBE_FAILED_REPLY });
    expect(d.transcribe).not.toHaveBeenCalled();
    expect(d.recordStt).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
