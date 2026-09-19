/**
 * The channel's continuity announcer: one spoken line per steer ("Up next, from Timba: ..."),
 * synthesised by SLNG and mixed into the stream by the broadcaster. It fills the ~20 s between a
 * steer being sent and the new scene reaching the screen.
 *
 * ponytail: clips live in memory, newest few only. They are played once, seconds after creation.
 */

const TTS_URL = "https://eu-west.api.slng.ai/v1/tts/slng/fish/tts:s2.1-pro";
const MAX_SPOKEN_IDEA_CHARS = 120;
const CLIPS_KEPT = 8;

const clips = new Map<string, Buffer>();

/** The line the announcer reads. Long ideas are cut at a word boundary so the read stays short. */
export function announcerLine(name: string, idea: string): string {
  const flat = idea.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_SPOKEN_IDEA_CHARS) return `Up next, from ${name}: ${flat}`;
  const cut = flat.slice(0, MAX_SPOKEN_IDEA_CHARS);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(" "), 1));
  return `Up next, from ${name}: ${atWord}, and more.`;
}

/** Synthesise a line and keep it for pickup. Returns the clip id. Throws on any SLNG failure. */
export async function synthesise(clipId: string, line: string): Promise<string> {
  const apiKey = process.env["SLNG_API_KEY"];
  if (!apiKey) throw new Error("SLNG_API_KEY is missing. Add it to .env (see docs/cards/slng.md).");
  const startedAt = performance.now();
  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: line, format: "mp3" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`SLNG TTS failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  // Kept as a log line on purpose: these are the latency numbers the SLNG submission asks for.
  console.info(
    `slng_tts ms=${Math.round(performance.now() - startedAt)} bytes=${audio.length} chars=${line.length}`,
  );
  clips.set(clipId, audio);
  for (const oldest of [...clips.keys()].slice(0, -CLIPS_KEPT)) clips.delete(oldest);
  return clipId;
}

export function clip(clipId: string): Buffer | undefined {
  return clips.get(clipId);
}
