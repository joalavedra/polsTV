/**
 * Telegram voice intake: a viewer sends the bot a voice note (or an uploaded audio file), it's
 * transcribed on SLNG, and the transcript is handed to the showrunner agent exactly as if the
 * viewer had typed it. A round-video message (`video_note`) is ignored here and falls through to
 * the showrunner untouched, same as before this pipeline existed.
 *
 * `handleVoiceMessage` is pure aside from its injected deps, so it is unit-tested with fakes (see
 * voice-intake.test.ts). `downloadTelegramFile` (ticker-intake.ts) and `transcribe`
 * (transcriber.ts) are the real implementations telegram.ts wires in for production.
 */
import type { Transcription } from "./transcriber";

// Mirrors index.ts's /say-voice limits (MAX_VOICE_AUDIO_BYTES, MIN_HEARD_CHARS) — not imported
// from there since index.ts imports telegram.ts, and telegram.ts imports this module.
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_BYTES = 1_500_000;
export const VOICE_MIN_HEARD_CHARS = 3;

export const VOICE_TOO_LONG_REPLY = "Keep voice messages under 30 seconds.";
export const VOICE_TRANSCRIBE_FAILED_REPLY = "Could not hear that, try again.";
export const VOICE_NOT_HEARD_REPLY = "Didn't catch that. Try again, a bit closer to the mic.";

const DEFAULT_VOICE_MIME = "audio/ogg";

/** Raw Telegram message shape this cares about (Bot API `Message.voice`/`Message.audio`),
 * duck-typed rather than imported from @chat-adapter/telegram since it doesn't export either
 * file type. */
interface TelegramAudioFileRaw {
  file_id: string;
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoiceMessageRaw {
  voice?: TelegramAudioFileRaw;
  audio?: TelegramAudioFileRaw;
}

export interface VoiceIntake {
  fileId: string;
  durationSeconds: number | undefined;
  sizeBytes: number | undefined;
  mimeType: string;
}

/** undefined when the raw message carries neither a voice note nor an uploaded audio file — a
 * text message, photo, or video_note routes as it did before this pipeline existed. */
export function extractTelegramVoice(raw: unknown): VoiceIntake | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { voice, audio } = raw as TelegramVoiceMessageRaw;
  const file = voice ?? audio;
  if (!file) return undefined;
  return {
    fileId: file.file_id,
    durationSeconds: file.duration,
    sizeBytes: file.file_size,
    mimeType: file.mime_type ?? DEFAULT_VOICE_MIME,
  };
}

export interface VoiceIntakeDeps {
  downloadAudio: (fileId: string) => Promise<Uint8Array>;
  transcribe: (audio: Uint8Array, mime: string) => Promise<Transcription>;
  /** Meters the SLNG STT call the same way say.ts's handleSay does (spend.ts's recordStt), always
   * scene-less: whether the transcript goes on to become a queued idea is decided later, inside the
   * showrunner agent's own tool call, which this pipeline has no clean way to await — see
   * telegram.ts's wiring and the final report for why that's the smallest correct choice. */
  recordStt: (name: string, text: string, audioSeconds: number) => void;
}

export type VoiceOutcome =
  | { kind: "too-long"; reply: string }
  | { kind: "transcribe-failed"; reply: string }
  | { kind: "not-heard"; reply: string }
  | { kind: "heard"; reply: string; transcript: string };

/**
 * The full voice-to-transcript pipeline: guard duration/size against Telegram's own metadata
 * (before spending anything on download or transcription), download, transcribe, then guard the
 * transcript length. Never throws — a download or transcribe failure is logged with context and
 * turned into a friendly "transcribe-failed" outcome, so a bad recording never reaches the agent.
 */
export async function handleVoiceMessage(
  deps: VoiceIntakeDeps,
  name: string,
  intake: VoiceIntake,
): Promise<VoiceOutcome> {
  const tooLong = (intake.durationSeconds ?? 0) > VOICE_MAX_SECONDS;
  const tooBig = (intake.sizeBytes ?? 0) > VOICE_MAX_BYTES;
  if (tooLong || tooBig) return { kind: "too-long", reply: VOICE_TOO_LONG_REPLY };

  let transcription: Transcription;
  try {
    const bytes = await deps.downloadAudio(intake.fileId);
    transcription = await deps.transcribe(bytes, intake.mimeType);
  } catch (error) {
    console.error(`telegram voice pipeline failed for ${name}:`, error);
    return { kind: "transcribe-failed", reply: VOICE_TRANSCRIBE_FAILED_REPLY };
  }

  const heard = transcription.text.trim();
  if (transcription.audioSeconds !== undefined) {
    deps.recordStt(name, heard, transcription.audioSeconds);
  }
  if (heard.length < VOICE_MIN_HEARD_CHARS) {
    return { kind: "not-heard", reply: VOICE_NOT_HEARD_REPLY };
  }
  return { kind: "heard", reply: `Heard: "${heard}"`, transcript: heard };
}
