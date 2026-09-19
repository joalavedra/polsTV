import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_ALLOWED_URL_PATTERNS } from "@fal-ai/server-proxy";
import { createRouteHandler } from "@fal-ai/server-proxy/hono";
import { LibSQLStore } from "@mastra/libsql";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import { announcerLine, clip, synthesise } from "./announcer";
import { channel } from "./channel";
import { MAX_IDEA_CHARS, moderate, moderator, sceneWriter, writeSteer } from "./showrunner";
import { spend } from "./spend";
import { notifySceneChange, showrunner } from "./telegram";
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

// Web callers may not claim a "telegram:" uid; those only come from the Telegram channel.
const uid = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const sayBody = z.object({
  uid,
  name: z.string().trim().min(1).max(24),
  text: z.string().trim().min(1).max(MAX_IDEA_CHARS),
  source: z.enum(["web", "voice"]).default("web"),
});
const likeBody = z.object({ uid });
const steerResultBody = z.object({
  steerId: z.number().int(),
  applied: z.boolean(),
  reason: z.string().max(200).optional(),
});

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

async function page(file: "index.html" | "broadcaster.html"): Promise<string> {
  for (const dir of pageDirs) {
    const html = await readFile(join(dir, file), "utf8").catch(() => undefined);
    if (html !== undefined) return html;
  }
  throw new Error(`${file} not found in any of: ${pageDirs.join(", ")}`);
}

export const mastra = new Mastra({
  agents: { moderator, sceneWriter, showrunner },
  // Channels (Telegram) need storage on the Mastra instance or subscriptions, dedup and approvals
  // reset on every restart. Also backs the showrunner's per-user memory (docs/cards/mastra-nebius).
  storage: new LibSQLStore({ id: "mastra-storage", url: "file:./mastra.db" }),
  server: {
    // Hosts inject PORT; parallel dev servers set it to avoid the 4111 default.
    port: Number(process.env["PORT"] ?? 4111),
    // Studio would otherwise claim "/" and shadow the viewer page.
    studioBase: "/studio",
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

      registerApiRoute("/status", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const viewer = uid.safeParse(c.req.query("uid"));
          if (viewer.success) channel.sawViewer(viewer.data);
          return c.json(channel.status());
        },
      }),

      // Not under /status: that route is polled every second by every viewer, and the spend pill
      // only needs a few-second cadence (docs/CONTRACT.md).
      registerApiRoute("/spend", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => c.json(spend.snapshot()),
      }),

      registerApiRoute("/say", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          const body = sayBody.safeParse(await c.req.json().catch(() => null));
          if (!body.success) return c.json({ ok: false, reason: "Invalid message." }, 400);
          let verdict, usage;
          try {
            ({ verdict, usage } = await moderate(body.data.text, body.data.name));
          } catch (error) {
            console.error("moderation failed, idea not queued:", error);
            return c.json({ ok: false, reason: "Moderation is unavailable, try again." }, 503);
          }
          if (!verdict.ok) {
            spend.recordModeration("rejected", body.data.name, body.data.text, usage);
            return c.json(verdict, 422);
          }
          const added = channel.addIdea(body.data);
          if (!added.ok) {
            spend.recordModeration("rejected", body.data.name, body.data.text, usage);
            return c.json(added, 409);
          }
          spend.recordModeration(added.idea.id, added.idea.name, added.idea.text, usage);
          return c.json({ ok: true, id: added.idea.id });
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
          const pending = channel.pendingSteer();
          if (pending) return c.json(pending);
          const idea = channel.nextIdea();
          if (!idea || !channel.canSteer() || writingSteer) return c.body(null, 204);
          writingSteer = true;
          try {
            // The announcer is garnish: a TTS failure is logged and the steer goes out without it.
            const [steerWrite, announcer] = await Promise.all([
              writeSteer(channel.status().now?.prompt, idea.text),
              synthesise(`steer-${idea.id}`, announcerLine(idea.name, idea.text))
                // Page-relative, so it still resolves when the app is served under a path prefix.
                .then((clipId) => ({ clipId, url: `announcer/${clipId}` }))
                .catch((error: unknown) => {
                  console.error(`announcer failed for idea ${idea.id}, steering without it:`, error);
                  return undefined;
                }),
            ]);
            spend.recordSteerWrite(idea.id, idea.name, idea.text, steerWrite.usage);
            if (announcer) {
              spend.recordTts(idea.id, idea.name, idea.text, clip(announcer.clipId)?.length ?? 0);
            }
            return c.json(channel.beginSteer(idea.id, steerWrite.prompt, announcer?.url));
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
          // the ledger needs one to move the idea's cost into notAired instead of a scene.
          const pendingBefore = channel.pendingSteer();
          const { onAir, ended } = channel.resolveSteer(body.data.steerId, body.data.applied);
          if (pendingBefore?.steerId === body.data.steerId) {
            if (onAir) spend.markAired(onAir.ideaId, onAir.name, onAir.text);
            else spend.markNotAired(pendingBefore.ideaId);
          }
          void notifySceneChange({ onAir, ended });
          return c.json({ ok: true, onAir: onAir?.ideaId ?? null });
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
