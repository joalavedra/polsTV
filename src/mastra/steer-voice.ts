/**
 * Whether a NEW steer carries a spoken clip, and what it costs. Silent unless the idea reads as a
 * request for an ad (`isAdIdea`, showrunner.ts); an ad idea gets the same ad-writing agent the
 * karma-gated pitch uses (`writeAdRead`), time-boxed, then synthesised by SLNG (`synthesise`,
 * announcer.ts). The two calls that touch the network are dependency-injected — like say.ts/
 * pitch.ts — so this is testable without Nebius, SLNG or a network: index.ts wires the real
 * functions as `steerVoiceDeps`.
 */
import { isAdIdea, type SpokenLineOutcome } from "./showrunner";
import type { TokenUsage } from "./spend";

/**
 * An ad write arriving after this is worthless: the scene is already on its way up. Only the write
 * is time-boxed here (`synthesise` keeps its own 10 s bound in announcer.ts); measured live against
 * Nebius (same fast model as the scene writer): five ad-read calls landed between 385-1253 ms.
 * 8 s is roughly 6x the slowest of those, room for a bad network hiccup, and still leaves 9-12 s of
 * margin under the ~17-20 s steer-to-screen gap once the scene writer's own ~6-7 s (running in
 * parallel) and Director's confirmation are accounted for.
 */
export const AD_WRITE_TIMEOUT_MS = 8_000;

export interface SteerVoiceOutcome {
  usage: TokenUsage;
  clipId: string | undefined;
  url: string | undefined;
}

export const SILENT_VOICE: SteerVoiceOutcome = {
  usage: { inputTokens: 0, outputTokens: 0 },
  clipId: undefined,
  url: undefined,
};

export interface SteerVoiceDeps {
  writeAdRead: (
    name: string,
    text: string,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<SpokenLineOutcome>;
  synthesise: (clipId: string, line: string) => Promise<string>;
}

/** Reject after `ms` whatever the model call does, so one slow write cannot hold up a steer. */
function afterTimeout(ms: number, what: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms).unref();
  });
}

/**
 * The clip a NEW steer carries, if any. Never throws and never outlasts `AD_WRITE_TIMEOUT_MS`: a
 * non-ad idea, a slow or failed write, an empty read, or a failed TTS call all steer out silent,
 * with the reason logged. On a TTS failure the write's own cost is still real and returned — only
 * the clip is missing.
 */
export async function decideSteerVoice(
  deps: SteerVoiceDeps,
  idea: { id: number; name: string; text: string },
): Promise<SteerVoiceOutcome> {
  if (!isAdIdea(idea.text)) return SILENT_VOICE;
  let ad: SpokenLineOutcome;
  try {
    ad = await Promise.race([
      deps.writeAdRead(idea.name, idea.text, {
        abortSignal: AbortSignal.timeout(AD_WRITE_TIMEOUT_MS),
      }),
      afterTimeout(AD_WRITE_TIMEOUT_MS, "ad writer"),
    ]);
  } catch (error) {
    console.warn(`ad read skipped for idea ${idea.id}, steering silent:`, error);
    return SILENT_VOICE;
  }
  try {
    const clipId = await deps.synthesise(`steer-${idea.id}`, ad.line);
    return { usage: ad.usage, clipId, url: `announcer/${clipId}` };
  } catch (error) {
    console.error(`announcer failed for idea ${idea.id}, steering without it:`, error);
    return { usage: ad.usage, clipId: undefined, url: undefined };
  }
}
