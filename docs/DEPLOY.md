# Deploying polsTV

One container, two processes tied together: the built Mastra server and a headless Chrome tab
holding `broadcaster.html` open (PLAN.md §3, docs/CONTRACT.md). See `Dockerfile` and
`scripts/start.sh` for how; this doc is where to run it.

Required env vars everywhere below: `BROADCASTER_SECRET`, `FAL_KEY`, `NEBIUS_API_KEY`,
`VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY64`, `SLNG_API_KEY`, `TELEGRAM_BOT_TOKEN`.
`scripts/start.sh` checks for all seven and refuses to start with a clear message if any are
missing.

**Gotcha:** this repo's `.env` wraps every value in double quotes (`KEY="value"`), which `source
.env` and `pnpm dev` strip correctly but `docker run --env-file` and `fly secrets import` do
**not** — they pass the quote characters through as part of the value, and auth then fails with
confusing errors (measured: Vonage's `createSession` rejected a key that had literal `"..."`
around it). Strip them once before using `.env` with either:

```bash
sed -E 's/^([^=]+)="(.*)"$/\1=\2/' .env > .env.docker
```

Use `.env.docker` (never commit it) wherever a tool reads env files as flat `KEY=VALUE`, below.

## a. Local run of the production build

```bash
pnpm install --ignore-scripts
pnpm rebuild esbuild   # the only dependency whose postinstall script matters — see Dockerfile
pnpm build             # -> .mastra/output/index.mjs, self-contained (own node_modules)

set -a; source .env; set +a
PORT=4403 DIRECTOR=off \
  CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  scripts/start.sh
```

Swap `CHROME_BIN` for Brave (`/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`) or
Chromium, whichever is installed. Add `CHROME_DEBUG_PORT=9333` to also read the broadcaster
page's own operator log over DevTools (`curl localhost:9333/json` for the target, then the
`Runtime.evaluate` method over its `webSocketDebuggerUrl` — local debugging only, never set in
production). `curl localhost:4403/status` should show `"live":true` within ~20s.

## b. Fly.io

CLI: not installed on this machine (`fly`/`flyctl` — none found). Install it, then:

```bash
fly launch --no-deploy        # detects the Dockerfile + fly.toml at the repo root
fly secrets import < .env.docker
fly secrets set PUBLIC_URL=https://<your-app>.fly.dev
fly deploy
```

`fly.toml` (committed) already sets:
- machine size `shared-cpu-2x` / 2GB memory — Chrome decodes 1344×768 video, draws a 1280×720
  canvas at 24fps and encodes it for Vonage, all in software (PLAN.md §3); size for that, not
  for the Node process.
- `min_machines_running = 1`, `auto_stop_machines = false` — Fly's default autostop would kill
  the Telegram long-polling bot the moment traffic goes quiet.
- `primary_region = "mad"` (Madrid); `"cdg"` (Paris) is the alternative if `mad` capacity is
  tight.
- an HTTP check on `GET /status`.

## c. Railway (alternative)

CLI: not installed on this machine. Railway auto-detects the root `Dockerfile`; no extra
`RAILWAY_DOCKERFILE_PATH` config needed. Then:

```bash
railway init            # or link an existing project
railway up               # builds + deploys from the Dockerfile
```

Set env vars in the dashboard's service → Variables → RAW Editor (paste `.env.docker`'s
contents, not `.env`'s — same quoting gotcha as above) or one at a time with
`railway variables set KEY=value`. Add `PUBLIC_URL=https://<service>.up.railway.app`. Leave
replicas at the default of 1 — the queue/karma state is in-process memory (PLAN.md §3) and the
Telegram bot double-polls (`409 Conflict`) with more than one instance running.

## d. PUBLIC_URL

`src/mastra/telegram.ts`'s `watchLink()` reads `PUBLIC_URL` (required, no default — it throws if
unset) and sends it verbatim in the bot's "you're on air" DM — it must be the exact URL a viewer
should open, trailing slash and all when one matters (see §e). Set it to the Fly/Railway URL
normally, or to the joalavedra.com URL when fronting through Vercel (§e).

## e. Fronting from joalavedra.com (Astro static site on Vercel)

A static site can't run this server, but Vercel can proxy to it. Add to
`joalavedra.com`'s `vercel.json`:

```json
{
  "rewrites": [{ "source": "/polstv/:path*", "destination": "https://<server-host>/:path*" }],
  "redirects": [{ "source": "/polstv", "destination": "/polstv/", "permanent": false }]
}
```

Replace `<server-host>` with the Fly/Railway host from §b/§c. This change lives in the
joalavedra.com repo, not this one — not made here, describing it only.

**Why the trailing slash matters:** `index.html` and `broadcaster.html` fetch page-relative
URLs (`status`, `say`, `b/<secret>/...`, `announcer/<id>`, `viewer-token`), not absolute
(`/status`) ones, specifically so they resolve correctly under a path prefix. A relative URL
resolves against the *directory* of the current page — `https://www.joalavedra.com/polstv/`
(trailing slash) makes `status` resolve to `.../polstv/status`, which the rewrite above catches;
`https://www.joalavedra.com/polstv` (no slash) makes the same relative URL resolve to
`https://www.joalavedra.com/status`, one directory up, which the rewrite never sees. The
redirect exists purely to force that trailing slash before the page's own scripts ever run.

**What does and doesn't go through the proxy:** WebRTC media (fal Director → broadcaster tab,
broadcaster tab → Vonage, Vonage → every viewer) is a direct browser↔Vonage connection and never
touches Vercel. The viewer page's 1-second `GET status` poll, `POST say`/`like`, and the
announcer audio fetch do go through it — expect Vercel's own request overhead on those, not on
video.

With this fronting in place, set `PUBLIC_URL=https://www.joalavedra.com/polstv/` (server-side,
§d) so the bot's DM link is the joalavedra.com one, not the bare Fly/Railway host.

## Local tool check (2026-09-19, this machine)

| CLI | present |
|---|---|
| `docker` | yes (`/usr/local/bin/docker`, OrbStack) |
| `vercel` | yes (`/opt/homebrew/bin/vercel`) |
| `fly` / `flyctl` | no |
| `railway` | no |

No login, deploy, or cloud resource was created by this task — §b/§c are copy-paste commands for
whoever has the CLIs and the account.
