import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_ALLOWED_URL_PATTERNS } from "@fal-ai/server-proxy";
import { createRouteHandler } from "@fal-ai/server-proxy/hono";
import { LibSQLStore } from "@mastra/libsql";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { clip, synthesise } from "./announcer";
import type { Idea } from "./channel";
import { channel } from "./channel";
import { handleEval, type EvalDeps } from "./eval";
import { livePitchDeps, PITCH_MIN_KARMA, pitchSlot, submitPitch } from "./pitch";
import type { SteerWriteOutcome } from "./showrunner";
import { handleSay, type SayDeps, type SayInput } from "./say";
import {
  amendWriter,
  MAX_IDEA_CHARS,
  MAX_PITCH_BRIEF_CHARS,
  moderate,
  moderator,
  narrator,
  pitchModerator,
  pitchWriter,
  sceneWriter,
  writeAmend,
  writeSteer,
  writeVoiceOver,
} from "./showrunner";
import type { TokenUsage } from "./spend";
import { spend } from "./spend";
import { notifyPitchDropped, notifySceneChange, showrunner } from "./telegram";
import { ticker } from "./ticker";
import { transcribe } from "./transcriber";
import { videoAccess } from "./vonage";

const broadcasterSecret = process.env["BROADCASTER_SECRET"];
if (!broadcasterSecret || broadcasterSecret.length < 32) {
  throw new Error("BROADCASTER_SECRET is missing or short. Set 32+ random chars in .env.");
}

let writingSteer = false;

// The broadcaster's next-steer poll doubles as its heartbeat (docs/CONTRACT.md); this tracks the
// wall-clock gap between polls so spend.ts can turn it into fal/Vonage seconds without owning a
// clock itself. undefined until the first poll, so server boot never bills a huge bogus first gap.
let lastHeartbeatAt: number | undefined;

/** Bill fal (only while Director is open) and Vonage (always) for the time since the last poll. */
function accrueHeartbeat(directorOpen: boolean): void {
  const now = Date.now();
  const elapsedMs = lastHeartbeatAt === undefined ? 0 : now - lastHeartbeatAt;
  lastHeartbeatAt = now;
  const status = channel.status();
  spend.accrueHeartbeat({
    elapsedMs,
    directorOpen,
    target: status.now?.ideaId ?? "idle",
    participants: status.viewers + 1, // + the broadcaster's own publisher connection
  });
}

interface SteerVoice {
  usage: TokenUsage;
  clipId: string | undefined;
  url: string | undefined;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * The line the channel's voice reads over the scene a steer is about to bring up: written by the
 * narrator, then synthesised by SLNG. The clip is garnish — a TTS failure is logged and the steer
 * goes out silent rather than late.
 */
async function narrateSteer(idea: Idea): Promise<SteerVoice> {
  const voiceOver = await writeVoiceOver(idea.name, idea.text);
  try {
    const clipId = await synthesise(`steer-${idea.id}`, voiceOver.line);
    // Page-relative, so it still resolves when the app is served under a path prefix.
    return { usage: voiceOver.usage, clipId, url: `announcer/${clipId}` };
  } catch (error) {
    console.error(`announcer failed for idea ${idea.id}, steering without it:`, error);
    return { usage: voiceOver.usage, clipId: undefined, url: undefined };
  }
}

// Web callers may not claim a "telegram:" uid; those only come from the Telegram channel.
const uid = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const name = z.string().trim().min(1).max(24);
const sayBody = z.object({
  uid,
  name,
  text: z.string().trim().min(1).max(MAX_IDEA_CHARS),
  source: z.enum(["web", "voice"]).default("web"),
  kind: z.enum(["new", "amend"]).default("new"),
});
// /say-voice's text-free fields: same uid/name rules as /say, reused rather than redeclared.
const sayVoiceFields = z.object({ uid, name });
const likeBody = z.object({ uid });
const pitchBody = z.object({
  uid,
  name: z.string().trim().min(1).max(24),
  brief: z.string().trim().min(1).max(MAX_PITCH_BRIEF_CHARS),
});
const evalBody = z.object({
  name,
  text: z.string().trim().min(1).max(MAX_IDEA_CHARS),
});
const steerResultBody = z.object({
  steerId: z.number().int(),
  applied: z.boolean(),
  reason: z.string().max(200).optional(),
});
const pitchResultBody = z.object({
  pitchId: z.number().int(),
  played: z.boolean(),
  reason: z.string().max(200).optional(),
});

// Which HTTP status each refusal from pitch.ts is worth. Everything else is a 200.
const pitchStatus = {
  karma: 403,
  cooldown: 429,
  busy: 409,
  rejected: 422,
  unavailable: 503,
} as const;

/** Drop pitches the broadcaster never collected and tell whoever submitted them. */
function sweepPitches(): void {
  pitchSlot.sweep();
  for (let dropped = pitchSlot.takeDropped(); dropped; dropped = pitchSlot.takeDropped()) {
    console.warn(`pitch ${dropped.id} from ${dropped.uid} was never played, dropped`);
    void notifyPitchDropped(dropped.uid);
  }
}

type BroadcasterPitch = { pitch: { pitchId: number; name: string; url: string } };

/** The pitch waiting for the air, handed to the broadcaster exactly once. */
function pitchForBroadcaster(): BroadcasterPitch | undefined {
  const pitch = pitchSlot.take();
  if (!pitch?.url) return undefined;
  return { pitch: { pitchId: pitch.id, name: pitch.name, url: pitch.url } };
}

function isBroadcaster(secret: string): boolean {
  const given = Buffer.from(secret);
  const expected = Buffer.from(broadcasterSecret as string);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Director's signalling bridge is missing from the proxy's default allow-list; without it every
// session fails with HTTP 400 before reaching fal (docs/cards/director.md, spike results).
const falProxy = createRouteHandler({
  allowedUrlPatterns: [...DEFAULT_ALLOWED_URL_PATTERNS, "wma.fal.run/**"],
});

// `mastra dev` does not serve src/mastra/public, and Studio's catch-all owns every other path, so
// the two pages get explicit routes. `mastra dev` runs with src/mastra/public as its working
// directory; `mastra build` copies that folder's files next to the bundle. cwd comes first so dev
// never serves a stale copy left in .mastra/output by an earlier build. Read per request so page
// edits show up without a restart.
const pageDirs = [process.cwd(), import.meta.dirname];

// Link previews need absolute URLs, and only the server knows where it is published.
const publicUrl = (process.env["PUBLIC_URL"] ?? "http://localhost:4111").replace(/\/+$/, "");

async function page(file: "index.html" | "broadcaster.html"): Promise<string> {
  for (const dir of pageDirs) {
    const html = await readFile(join(dir, file), "utf8").catch(() => undefined);
    if (html !== undefined) return html.replaceAll("__PUBLIC_URL__", publicUrl);
  }
  throw new Error(`${file} not found in any of: ${pageDirs.join(", ")}`);
}

// Exactly these files: the same folder also holds mastra.db in dev, which must never be served.
const assets: Record<string, string> = {
  "og.jpg": "image/jpeg",
  "logo.jpg": "image/jpeg",
  "icon.png": "image/png",
};

async function asset(file: string): Promise<Buffer | undefined> {
  if (!Object.hasOwn(assets, file)) return undefined;
  for (const dir of pageDirs) {
    const bytes = await readFile(join(dir, file)).catch(() => undefined);
    if (bytes !== undefined) return bytes;
  }
  return undefined;
}

// Moderation is a paid LLM call, so one idea or pitch per client every few seconds is plenty.
const POST_MIN_GAP_MS = 3_000;
const lastPostAt = new Map<string, number>();

function postTooSoon(client: string): boolean {
  const now = Date.now();
  if (now - (lastPostAt.get(client) ?? 0) < POST_MIN_GAP_MS) return true;
  lastPostAt.set(client, now);
  if (lastPostAt.size > 5_000) lastPostAt.clear();
  return false;
}

/** The next candidate to steer, dropping any amend whose target scene has already moved on or is
 * full up on changes — "Yes, and" only ever touches the scene it was written for. */
function nextSteerableIdea(): Idea | undefined {
  let idea = channel.nextIdea();
  while (idea && channel.isStaleAmend(idea)) {
    channel.dropIdea(idea.id);
    spend.markNotAired(idea.id);
    idea = channel.nextIdea();
  }
  return idea;
}

/** New ideas transition from the current scene; amends restate it and change one thing. */
async function writeForIdea(idea: Idea, currentPrompt: string | undefined): Promise<SteerWriteOutcome> {
  if (idea.kind === "new") return writeSteer(currentPrompt, idea.text);
  if (currentPrompt === undefined) {
    throw new Error(`amend idea ${idea.id} has no scene on air to amend`);
  }
  return writeAmend(currentPrompt, idea.text);
}

// Only proxied (public) traffic is limited; localhost has no forwarding header.
function clientIp(c: { req: { header(name: string): string | undefined } }): string | undefined {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for");
}

// A MediaRecorder blob's type carries a codec parameter (e.g. "audio/webm;codecs=opus"); strip it
// before comparing against the accepted list or handing it to SLNG.
function declaredAudioType(audio: Blob): string {
  return (audio.type || "application/octet-stream").split(";")[0]?.trim() ?? "";
}

const sayDeps: SayDeps = {
  moderate,
  addIdea: (input) => channel.addIdea(input),
  recordModeration: (target, n, t, usage) => spend.recordModeration(target, n, t, usage),
  recordStt: (target, n, t, audioSeconds) => spend.recordStt(target, n, t, audioSeconds),
};

// No side effects: nothing queued, nothing aired, nothing spent — see eval.ts and docs/CONTRACT.md.
const evalDeps: EvalDeps = { moderate, writeSteer };

// /say-voice's audio boundary: MediaRecorder clips for a 10 s hold-to-talk cap land well under
// this; anything smaller than 1 KB is not real speech.
const MIN_VOICE_AUDIO_BYTES = 1_000;
const MAX_VOICE_AUDIO_BYTES = 1_500_000;
// Verified live against SLNG (docs/cards/slng.md UNVERIFIED note): all four, including Safari's
// audio/mp4 (aac), are accepted with no extra encoding hint.
const ACCEPTED_VOICE_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"]);
const MIN_HEARD_CHARS = 3;

export const mastra = new Mastra({
  agents: { moderator, sceneWriter, amendWriter, narrator, pitchModerator, pitchWriter, showrunner },
  // Channels (Telegram) need storage on the Mastra instance or subscriptions, dedup and approvals
  // reset on every restart. Also backs the showrunner's per-user memory (docs/cards/mastra-nebius).
  storage: new LibSQLStore({ id: "mastra-storage", url: "file:./mastra.db" }),
  server: {
    // Hosts inject PORT; parallel dev servers set it to avoid the 4111 default.
    port: Number(process.env["PORT"] ?? 4111),
    // Studio would otherwise claim "/" and shadow the viewer page.
    studioBase: "/studio",
    // Mastra's own /api (agents, memory, tools) and Studio have no auth. They stay usable on
    // localhost, but any request that arrived through a tunnel or reverse proxy is refused:
    // those always carry a forwarding header, and a client cannot strip one the proxy adds.
    middleware: [
      async (c, next) => {
        const path = c.req.path;
        const internal = path === "/api" || path.startsWith("/api/") || path.startsWith("/studio");
        const proxied = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for");
        if (internal && proxied) return c.notFound();
        return next();
      },
    ],
    apiRoutes: [
      registerApiRoute("/", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => c.html(await page("index.html")),
      }),

      registerApiRoute("/broadcaster.html", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => c.html(await page("broadcaster.html")),
      }),

      registerApiRoute("/assets/:file", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const file = c.req.param("file");
          const bytes = await asset(file);
          if (!bytes) return c.notFound();
          return c.body(new Uint8Array(bytes), 200, {
            "content-type": assets[file] ?? "application/octet-stream",
            "cache-control": "public, max-age=3600",
          });
        },
      }),

      // Viewers on phones cannot show us their console. The page posts one capability report per
      // load; it is only logged. This is how "it says incompatible browser on my iPhone" gets facts.
      registerApiRoute("/diag", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          const client = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
          if (postTooSoon(`diag:${client}`)) return c.body(null, 429);
          const report = (await c.req.text()).slice(0, 2_000).replace(/[\r\n]+/g, " ");
          console.info(`client_diag ${report}`);
          return c.body(null, 204);
        },
      }),

      registerApiRoute("/status", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const viewer = uid.safeParse(c.req.query("uid"));
          if (viewer.success) channel.sawViewer(viewer.data);
          sweepPitches();
          return c.json({ ...channel.status(), pitch: pitchSlot.status() ?? null });
        },
      }),

      // Per-viewer state the whole channel does not need: /status is polled every second by
      // everyone watching, this only when the pitch button needs to know where a viewer stands.
      registerApiRoute("/me", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const viewer = uid.safeParse(c.req.query("uid"));
          if (!viewer.success) return c.json({ ok: false, reason: "Invalid uid." }, 400);
          const karma = channel.karmaOf(viewer.data);
          return c.json({
            karma,
            pitchUnlocked: karma >= PITCH_MIN_KARMA,
            pitchCooldownSeconds: pitchSlot.cooldownSeconds(viewer.data),
          });
        },
      }),

      // Not under /status: that route is polled every second by every viewer, and the spend pill
      // only needs a few-second cadence (docs/CONTRACT.md).
      registerApiRoute("/spend", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => c.json(spend.snapshot()),
      }),

      // Public, read-only: the ticker bar public/index.html draws at the bottom of the page.
      // Images arrive over Telegram (telegram.ts's onDirectMessage); these just serve what's
      // currently on it.
      registerApiRoute("/ticker", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) =>
          c.json({
            items: ticker.list().map((item) => ({
              id: item.id,
              name: item.name,
              caption: item.caption,
              url: `ticker/${item.id}`,
            })),
          }),
      }),

      registerApiRoute("/ticker/:id", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const id = Number(c.req.param("id"));
          const item = Number.isInteger(id) ? ticker.get(id) : undefined;
          if (!item) return c.notFound();
          return c.body(new Uint8Array(item.bytes), 200, {
            "content-type": item.mime,
            "cache-control": "public, max-age=600",
          });
        },
      }),

      registerApiRoute("/say", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          const body = sayBody.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ ok: false, reason: "Invalid message." }, 400);
          const client = clientIp(c);
          if (client && postTooSoon(client)) {
            return c.json({ ok: false, reason: "Slow down a little." }, 429);
          }
          const outcome = await handleSay(sayDeps, body.data);
          return c.json(outcome.body, outcome.status);
        },
      }),

      // multipart/form-data: uid, name, audio. Same moderated path as /say, spoken instead of
      // typed — see handleSay. docs/CONTRACT.md.
      registerApiRoute("/say-voice", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          const form = await c.req.formData().catch(() => undefined);
          const audio = form?.get("audio");
          const rawFields = { uid: form?.get("uid"), name: form?.get("name") };
          const fields = sayVoiceFields.safeParse(rawFields);
          if (!fields.success || !(audio instanceof Blob)) {
            return c.json({ ok: false, reason: "Invalid message." }, 400);
          }
          const declaredType = declaredAudioType(audio);
          if (!ACCEPTED_VOICE_TYPES.has(declaredType)) {
            return c.json({ ok: false, reason: `Unsupported audio type: ${declaredType}.` }, 415);
          }
          if (audio.size < MIN_VOICE_AUDIO_BYTES || audio.size > MAX_VOICE_AUDIO_BYTES) {
            return c.json({ ok: false, reason: "Recording is too short or too long." }, 415);
          }
          // Rate limit BEFORE calling SLNG: each call costs money (same limiter as /say).
          const client = clientIp(c);
          if (client && postTooSoon(client)) {
            return c.json({ ok: false, reason: "Slow down a little." }, 429);
          }
          const bytes = new Uint8Array(await audio.arrayBuffer());
          let transcription;
          try {
            transcription = await transcribe(bytes, declaredType);
          } catch (error) {
            console.error("transcription failed:", error);
            return c.json({ ok: false, reason: "Could not hear that, try again." }, 503);
          }
          const heard = transcription.text.trim();
          const audioSeconds = transcription.audioSeconds;
          if (heard.length < MIN_HEARD_CHARS) {
            if (audioSeconds !== undefined) {
              spend.recordStt("rejected", fields.data.name, "", audioSeconds);
            }
            const reason = "Didn't catch that. Try again, a bit closer to the mic.";
            return c.json({ ok: false, reason, heard }, 422);
          }
          const voiceInput: SayInput = { ...fields.data, text: heard, source: "voice" };
          const stt = audioSeconds === undefined ? undefined : { audioSeconds };
          const outcome = await handleSay(sayDeps, voiceInput, stt);
          return c.json({ ...outcome.body, heard }, outcome.status);
        },
      }),

      registerApiRoute("/pitch", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          const body = pitchBody.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ ok: false, reason: "Invalid pitch." }, 400);
          // Only proxied (public) traffic is limited; localhost has no forwarding header.
          const client = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for");
          if (client && postTooSoon(client)) {
            return c.json({ ok: false, reason: "Slow down a little." }, 429);
          }
          const result = await submitPitch(pitchSlot, livePitchDeps, body.data);
          if (!result.ok) return c.json(result, pitchStatus[result.code]);
          return c.json(result);
        },
      }),

      registerApiRoute("/like", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          const body = likeBody.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ ok: false }, 400);
          return c.json({ ok: channel.like(body.data.uid) });
        },
      }),

      registerApiRoute("/viewer-token", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => c.json(await videoAccess("subscriber")),
      }),

      registerApiRoute("/b/:secret/publisher-token", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          if (!isBroadcaster(c.req.param("secret"))) return c.notFound();
          return c.json(await videoAccess("publisher"));
        },
      }),

      registerApiRoute("/b/:secret/next-steer", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          if (!isBroadcaster(c.req.param("secret"))) return c.notFound();
          channel.sawBroadcaster();
          // ?director=1 while a Director session is open (broadcaster.html); this poll is also the
          // broadcaster's heartbeat, so bill it every time regardless of what it returns below.
          accrueHeartbeat(c.req.query("director") === "1");
          sweepPitches();
          // Rides along with whatever this poll was going to answer, including a 204 with nothing
          // else in it. The broadcaster queues it behind any clip already playing.
          const pitch = pitchForBroadcaster();
          const pending = channel.pendingSteer();
          if (pending) return c.json({ ...pending, ...pitch });
          const idea = nextSteerableIdea();
          if (!idea || !channel.canSteer() || writingSteer) {
            return pitch ? c.json(pitch) : c.body(null, 204);
          }
          writingSteer = true;
          try {
            // An amend is a small on-screen tweak: no narrated "up next" clip for it (that voice
            // call itself costs Nebius tokens, not just the TTS) — a voice line for every small
            // tweak would talk over the show.
            const noVoice: SteerVoice = { usage: ZERO_USAGE, clipId: undefined, url: undefined };
            const [steerWrite, voice] = await Promise.all([
              writeForIdea(idea, channel.status().now?.prompt),
              idea.kind === "amend" ? noVoice : narrateSteer(idea),
            ]);
            spend.recordSteerWrite(idea.id, idea.name, idea.text, steerWrite.usage);
            if (idea.kind !== "amend") {
              spend.recordSteerWrite(idea.id, idea.name, idea.text, voice.usage);
            }
            if (voice.clipId) {
              spend.recordTts(idea.id, idea.name, idea.text, clip(voice.clipId)?.length ?? 0);
            }
            const steer = channel.beginSteer(idea.id, steerWrite.prompt, voice.url);
            return c.json({ ...steer, ...pitch });
          } finally {
            writingSteer = false;
          }
        },
      }),

      registerApiRoute("/announcer/:clipId", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const audio = clip(c.req.param("clipId"));
          if (!audio) return c.notFound();
          return c.body(new Uint8Array(audio), 200, { "content-type": "audio/mpeg" });
        },
      }),

      registerApiRoute("/b/:secret/steer-result", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          if (!isBroadcaster(c.req.param("secret"))) return c.notFound();
          const body = steerResultBody.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ ok: false }, 400);
          if (!body.data.applied) console.warn("director rejected a steer:", body.data.reason);
          // Captured before resolving: on rejection resolveSteer's result carries no ideaId, but
          // the ledger needs one to move the idea's cost into notAired instead of a scene. Also
          // the right id for an applied amend: its own (pendingBefore.ideaId), not the scene it
          // amended (onAir.ideaId) — that's where recordSteerWrite filed its cost.
          const pendingBefore = channel.pendingSteer();
          const { onAir, ended, amended } = channel.resolveSteer(body.data.steerId, body.data.applied);
          if (pendingBefore?.steerId === body.data.steerId) {
            if (onAir) spend.markAired(pendingBefore.ideaId, onAir.name, onAir.text);
            else spend.markNotAired(pendingBefore.ideaId);
          }
          void notifySceneChange({ onAir, ended, amended });
          return c.json({ ok: true, onAir: onAir?.ideaId ?? null });
        },
      }),

      registerApiRoute("/b/:secret/pitch-result", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          if (!isBroadcaster(c.req.param("secret"))) return c.notFound();
          const body = pitchResultBody.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ ok: false }, 400);
          if (!body.data.played) console.warn("pitch clip did not play:", body.data.reason);
          pitchSlot.release(body.data.pitchId);
          return c.json({ ok: true });
        },
      }),

      // No queue, no air, no spend: runs moderation and (when accepted) the steering-prompt writer
      // on one input and returns the result. The Galtea evaluation hook (docs/CONTRACT.md).
      registerApiRoute("/b/:secret/eval", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          if (!isBroadcaster(c.req.param("secret"))) return c.notFound();
          const body = evalBody.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ ok: false, reason: "Invalid message." }, 400);
          const outcome = await handleEval(evalDeps, body.data);
          return c.json(outcome.body, outcome.status);
        },
      }),

      registerApiRoute("/b/:secret/fal-proxy", {
        method: "ALL",
        requiresAuth: false,
        handler: async (c) => {
          if (!isBroadcaster(c.req.param("secret"))) return c.notFound();
          // Mastra vendors its own copy of Hono's types, so its Context is nominally distinct from
          // the one the proxy adapter declares. Same runtime object.
          const upstream = await falProxy(c as unknown as Parameters<typeof falProxy>[0]);
          // The adapter hands back fetch's Response, whose headers are immutable; Mastra's
          // middleware then throws "TypeError: immutable" adding its own. Re-wrap it. fetch has
          // already decoded the body, so the encoding and length headers no longer describe it.
          const headers = new Headers(upstream.headers);
          headers.delete("content-encoding");
          headers.delete("content-length");
          return new Response(upstream.body, { status: upstream.status, headers });
        },
      }),
    ],
  },
});
