/**
 * The channel's voice: SLNG TTS for the ad reads it speaks — an ad read for a steer whose idea
 * asks for an ad (showrunner.ts's `isAdIdea`), and the karma-gated pitch's ad read — mixed into the
 * stream by the broadcaster.
 *
 * ponytail: clips live in memory, newest few only. They are played once, seconds after creation.
 */
// Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
import { log } from "./log";

const TTS_URL = "https://eu-west.api.slng.ai/v1/tts/slng/fish/tts:s2.1-pro";
const CLIPS_KEPT = 8;

// `slng/fish/tts:s2.1-pro` reads a leading "[emotion]" bracket tag as a silent tone control, not
// spoken text -- verified live by synthesising "[excited] Testing one two three." and transcribing
// it back with transcriber.ts: the transcript came back "Testing one, two, three." with no trace of
// the tag. Added here, not in the text callers pass in, so the line returned to a pitch submitter
// (shown in a toast, DMed on Telegram) never carries it.
// ponytail: hardcoded for every caller since synthesise() is only ever used for ad reads today; add
// a `tone` param if a non-ad caller shows up.
const TTS_TONE_MARKER = "[excited]";

// The clean line ships alongside the audio so the AD banner (ad-banner.ts) can show the same words
// the voice is reading, without re-deriving them from the TTS-marked text sent to SLNG.
interface Clip {
  audio: Buffer;
  line: string;
}

const clips = new Map<string, Clip>();

/** Synthesise a line and keep it for pickup. Returns the clip id. Throws on any SLNG failure. */
export async function synthesise(clipId: string, line: string): Promise<string> {
  const apiKey = process.env["SLNG_API_KEY"];
  if (!apiKey) throw new Error("SLNG_API_KEY is missing. Add it to .env (see docs/cards/slng.md).");
  const spoken = `${TTS_TONE_MARKER} ${line}`;
  const startedAt = performance.now();
  let response: Response;
  try {
    // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
    response = await fetch(TTS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken, format: "mp3" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`SLNG TTS request failed (network or timeout) for clip ${clipId}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`SLNG TTS failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  let audio: Buffer;
  try {
    audio = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`SLNG TTS response body read failed for clip ${clipId}`, { cause: error });
  }
  // Kept as a log line on purpose: these are the latency numbers the SLNG submission asks for.
  // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
  log.info(
    `slng_tts ms=${Math.round(performance.now() - startedAt)} bytes=${audio.length} chars=${spoken.length}`,
  );
  clips.set(clipId, { audio, line });
  for (const oldest of [...clips.keys()].slice(0, -CLIPS_KEPT)) clips.delete(oldest);
  return clipId;
}

export function clip(clipId: string): Buffer | undefined {
  return clips.get(clipId)?.audio;
}

/** The clean line synthesise() was given for this clip, for the on-screen AD banner. */
export function clipLine(clipId: string): string | undefined {
  return clips.get(clipId)?.line;
}
