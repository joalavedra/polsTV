// Director spike: fal proxy + log/frame sinks. Throwaway. Run: node --env-file=../.env server.mjs
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { DEFAULT_ALLOWED_URL_PATTERNS } from "@fal-ai/server-proxy";
import { createRouteHandler } from "@fal-ai/server-proxy/hono";
import { Hono } from "hono";

if (!process.env.FAL_KEY) throw new Error("FAL_KEY missing: run with --env-file=../.env");

const dir = import.meta.dirname;
await mkdir(`${dir}/frames`, { recursive: true });

const app = new Hono();
// The proxy's default allow-list has no wma.fal.run, which is the bridge Director's WebRTC
// signalling goes through. Without this the proxy itself answers 400 "Invalid request".
app.all(
  "/api/fal/proxy",
  createRouteHandler({ allowedUrlPatterns: [...DEFAULT_ALLOWED_URL_PATTERNS, "wma.fal.run/**"] }),
);
app.get("/", async (c) => c.html(await readFile(`${dir}/spike.html`, "utf8")));
app.post("/log", async (c) => {
  await appendFile(`${dir}/log.jsonl`, `${await c.req.text()}\n`);
  return c.body(null, 204);
});
app.post("/frame/:name", async (c) => {
  const name = c.req.param("name").replace(/[^\w-]/g, "");
  await writeFile(`${dir}/frames/${name}.jpg`, Buffer.from(await c.req.arrayBuffer()));
  return c.body(null, 204);
});

// ponytail: localhost-only, so the proxy is ungated here. The real server gates it with a secret.
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 3100 });
console.log("spike on http://127.0.0.1:3100");
