# Infinite Slop — teardown

**Method note:** everything under "Observed" came from loading the live site in a headless browser, reading its network log, and `curl`-ing its own JSON endpoints plus its full 122KB HTML source (single file, all logic inline and unminified, with the author's own comments intact — unusually legible). "Inferred" and "Not verified" are marked.

Captured 2026-09-19. Target: https://infiniteslop.ai/

---

## 1. What it is

Infinite Slop is a single, shared, never-ending AI-generated TV channel that everyone watching sees simultaneously. It plays as a real HLS live stream — no scroll, no feed, no per-user content. The entire product is one full-bleed video plus a chat box. What you type in chat becomes the prompt for a video clip; an LLM rewrites your one-line idea into a detailed cinematic prompt that deliberately carries over visual elements from the clip before it, so the channel drifts as a loose continuous narrative rather than a series of disconnected clips. A worker pool generates ~15-second clips faster than they play, so the buffer never drains and the stream never stalls. Viewers tap the screen to like the clip that's airing; likes become "karma" credited to whoever prompted it, which drives a leaderboard and queue priority. It is free, anonymous (no login — just pick a nickname), monetized by sponsor pre-roll ads, and the compute is sponsored by fal.ai. Built by Pieter Levels (@levelsio).

## 2. UX walkthrough, state by state

**Splash (`#splash`)** — full-viewport click-to-tune overlay over the already-playing muted video. Wordmark, a ▶ glyph, four lines of value prop, credits. The tap is deliberately load-bearing: it's the user gesture browsers require to start unmuted playback. Dismissed forever after (`localStorage`).

**Live state** — three zones over a full-bleed `object-fit:cover` video:

- *Top center:* `LIVE` pill (red, pulsing dot). When you're watching an older clip it turns into a dark "↑ back to live" button.
- *Top right stack:* `interface` (hide all chrome for pure-TV mode), `mute`/`unmute`, `buy ad`, `channels`, plus a viewer count.
- *Left rail (desktop only):* the pipeline made visible — `NEXT` (approved, queued), `NOW GENERATING`, `QUEUE` (with ▲ vote arrows and a vote count).
- *Right panel:* tabs `CHAT` / `QUEUE` / `RANK`. Chat bubbles are pastel-tinted by a hash of the username, each showing time, name, karma star badge, and the prompt text. Bottom: input placeholder `What you wanna see next...` and a `Say` button.
- *Caption bar* over the video top-center shows the chat line that produced the currently airing clip, so you always know whose idea is on screen.

**Mobile (390px)** — same video, controls collapse to the top-right stack, and the left rail is dropped; `CHAT / QUEUE / RANK` becomes a three-tab strip over the lower half. Verified at 390×844.

**Posting flow** — no accounts. First send opens a name modal (`Pick a name to chat` → `Join`), gated by a **Cloudflare Turnstile** challenge (`Quick check that you're human` / `Verification failed, please try again.`, sitekey `0x4AAAAAAECJ0oobmd_WXz-S`). Then your message goes to server-side moderation *before* it appears anywhere — the input shows an animated `checking |/-\` spinner, and on accept you get a `queued!` toast and your bubble appears; on reject you get the reason. Per the author's own source comment: nothing unapproved ever appears in chat. There's a 25s client-side failsafe so a stalled moderator can't wedge the box.

**Interactions** — tap anywhere on the video to like (once per segment, tracked client-side); ▲ vote to boost items in the queue; click a username to open a profile pane with karma, follower count and their past clips, plus a `FOLLOW` / `FOLLOWING` button; `channels` opens a dropdown of AI-tagged rerun channels built from the archive. Karma milestones (1/10/25/50/100/250/500/1000) trigger a gold-star celebration overlay.

**Monetization** — pre-roll sponsor ads play on their own overlay layer so the live stream keeps buffering behind them and the handoff is seamless (the author's comment: no cold HLS start = no lag/glitch after the ad). `buy ad` links to `api/buyad`. Live sponsors at capture time: SideShift.ai, Chatbase, Creem.io. Ad clicks are tracked via `api/adclick`. The `$8500 cash prizes` line is a karma-leaderboard prize pool; **I could not verify the rules or payout mechanism** — there's no about/FAQ/terms page on the site at all.

## 3. Exact copy

- **Title / OG title:** `Infinite Slop by @levelsio + fal.ai`
- **OG + Twitter description:** `An endless AI-generated TV channel where you decide what airs next.`
- **Splash wordmark:** `Infinite Slop`
- **Splash sub-block** (four lines):
  - `an endless AI-generated TV channel`
  - `you decide what airs next`
  - `get karma if your video is liked`
  - `win $8500 cash prizes`
- **Splash hint:** `tap the screen to ♥ like`
- **First-visit toast:** `tap the screen to ❤ like — likes give the creator karma`
- **Credits:** `by @levelsio +` followed by the fal logo, linking to `https://fal.ai/minimax-h3-max`
- **Buttons:** `unmute` / `mute`, `💰 buy ad`, `📺 channels`, `✕ interface`, `Say`, `Join`, `change name`, `FOLLOW` / `FOLLOWING`
- **Tabs:** `CHAT` `QUEUE` `RANK`
- **Rank time windows:** `24H` `7D` `30D` `ALL`
- **Left rail labels:** `NEXT` `NOW GENERATING` `QUEUE`
- **Category chips:** `🍌 banana` `🐱 cat` `🚀 space` `📺 news` `🎮 game show`
- **Channel filters:** `🔴 LIVE` `❤️ TOP` `🆕 NEWEST` `⏮ OLDEST`
- **Input placeholder:** `What you wanna see next...`; checking state `checking |` (animates `| / - \`)
- **Turnstile modal:** `Quick check that you're human` / `Verification failed, please try again.`
- **Name modal:** `Pick a name to chat` / `Join`
- **Empty leaderboard:** `no karma yet — get your video liked!` (also `no karma today` / `no karma this week` / `no karma the last 30 days` per window)
- **Profile line format:** `{karma} · {followers} followers · {n} videos`
- **Karma milestone overlay:** `{n} karma!`
- **Favicon:** an emoji data-URI SVG.
- **No footer, no about page, no FAQ, no terms of service.** The four splash lines are the entire marketing surface.

## 4. Visual design

Dark "frosted glass over full-bleed video." Body is pure black, everything floats over the video with `backdrop-filter: blur(14px)` pills.

**Fonts** — two families only:
- **Shrikhand** (Google Fonts, fallback `'Cooper Black', serif`) for the wordmark — a fat retro slab, set in white with a 16px black stroke (`-webkit-text-stroke:16px #000; paint-order:stroke fill`) plus four stacked hard shadows (`5px 5px 0 #000, 10px 10px 0 #000, 15px 15px 0 #000, …`) to make one solid black extrusion rather than a hollow outline.
- **Tahoma** (`font-family:Tahoma,system-ui,sans-serif`) for all UI chrome, which reads deliberately cheap and 2003-ish.
- Chat text switches to a system stack: `-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif`.

**Palette** (extracted from CSS, by frequency):

| Hex | Count | Use |
|---|---|---|
| `#000` | 98 | ground, shadows, text stroke |
| `#fff` | 60 | text, surfaces |
| `#ff4742` | 29 | accent red — likes, karma stars, accent pills |
| `#111` | 26 | dark surfaces |
| `#ff2fd0` | 6 | magenta accent |
| `#e11d2a` | 6 | LIVE pill red |
| `#ffe14d` | 5 | yellow |
| `#221600` | 5 | deep brown |
| `#ffd86b` | 4 | gold |
| `#ffd24d`, `#ff8a3d`, `#8a4bff`, `#42a5ff`, `#22ffd0` | 3 each | secondary accents (purple / blue / teal) |
| `#ffd257` | 1 | `buy ad` button gold |

Chat bubbles get per-user pastel fills generated as `hsl(hash(name) % 360, 85%, 85%)` — deterministic per nickname.

**Motion** is restrained and functional: a 1.4s pulsing live dot (`@keyframes livedot{50%{opacity:.25}}`), `transform: scale(.96)` on button press, a spinning ASCII "thinker" in the input at 110ms/frame, a gold sparkle burst on karma milestones, and a `#switchfx` canvas that holds a dimmed last frame during channel switches so you never see a black flash.

**Craft tell:** clips letterbox to their *own* aspect. The viewport is never exactly 16:9, so `contain` always left thin bars — they use `cover` and crop the sliver, composing clips center-safe. Old 9:16 portrait reruns would be mangled by `cover` on a landscape screen, so those get a `.portraitclip` class (set from the video's real dimensions) that switches them back to `contain` above 821px.

**Overall vibe:** brutalist-arcade bones (hard black shadows, fat display type) softened into a glassy modern player. The source shows this is literally the "index4 / glass" layout — there's a paused A/B test against an earlier brutalist `index3`, and an `abv` cookie still stamps the variant (`max-age=1209600`).

## 5. How content is generated

**Live, not pre-generated.** Observed directly in `status.json`, which is the whole pipeline exposed in one public file:

- `now_chat` — the raw user line, e.g. `AngryScotsman: a chocolate factory where everything is eatable`
- `now_playing` — the LLM-expanded prompt actually sent to the video model. These are long, highly specified, and explicitly reference the previous clip's elements: *"…the same three deadpan singers in now-grunge flannel over shoulder pads march stiffly around the massive rotating chocolate wheel still sputtering…"* and *"the prior flickering purple buoy-light now pulses as a frost-coated orb…"*. **Continuity is a prompt-engineering trick, not a video-model feature.**
- `cont: true/false` per queued item flags whether that clip continues the previous one.
- `generating` / `generating_chat` / `generating_now[]` — the in-flight jobs (2 concurrent at capture time).
- `buffer_clips: 4`, `generating_clips: 2`, `buffer_secs: 60` — the entire "never stalls" trick in three numbers.
- `generated_total: 11912`, `chat_messages: 263754`, `last_error: null`
- `likes` — per-segment like counts, e.g. `{"121681.ts": 6, "121691.ts": 8, …}`
- `sponsors` — `{"SideShift.ai": "https://sideshift.ai", "Chatbase": "https://www.chatbase.co", "Creem.io": "https://creem.io/join/infiniteslop"}`
- `preroll` — `[{id, chat, dur}]` ad clips
- `queue` — `[{id, u, m, at, v}]` (id, user, message, timestamp, votes)
- `recent`, `playing_next`, `live`, `paused`, `viewers_active`, `now_replay`, `now_generated_at`, `ts`

`live/meta.json` is a segment→metadata map: `{"121658.ts": {prompt, chat, gen_at, replay}}`. **The full prompt archive is public.**

The style prompts observed are era-specific and detailed — "1990s camcorder public-access VHS with harsh flash and CRT scanlines", "1970s 16mm film grain tungsten-lit retro diner kitchen", "1980s analog broadcast VHS with neon chrome edges and tape-warm static". One observed prompt also carried explicit guardrails against depicting real actors and against on-screen text, suggesting the expansion layer injects safety/style boilerplate.

**Model:** the site's own fal credit links to `https://fal.ai/minimax-h3-max` — i.e. **MiniMax H3 Max on fal.ai**. Levels states publicly that fal fine-tuned MiniMax H3 to be ~50× faster, making generation faster than playback; fal quotes a 5s 768p clip in under three seconds.

**Not verified:** the orchestration LLM that expands prompts and maintains continuity is not identified anywhere — not in the bundle, not in any response, not in his post. Same for the moderation model.

**Media / hosting:** HLS.
- `live/playlist.m3u8` — rolling 6-segment window, `#EXT-X-VERSION:3`, `#EXT-X-TARGETDURATION:16`, `#EXT-X-MEDIA-SEQUENCE`/`#EXT-X-DISCONTINUITY-SEQUENCE` both at 126654, and an `#EXT-X-DISCONTINUITY` before **every** segment (each clip is an independent encode).
- `#EXTINF:15.123` — every clip is exactly 15.123s (`dur: 15.123223` in the ad payloads).
- Segments are MPEG-TS at `live/{clipId}.ts`, ~3.1–3.4MB each.
- Played via self-hosted `hls.min.js` (128KB).
- Poster frame at `live/poster.jpg?t={cachebuster}`.
- Everything same-origin behind Cloudflare; a `preconnect` points at an R2 bucket (`da2eb1c521cce7d6e8e091970f46fe1b.r2.cloudflarestorage.com`) for archive clips, with a source comment noting the warm `api/clip` fetch is served from the edge rather than R2.
- `api/clip?id=N&pl=1` returns a per-clip m3u8 (`content-type: application/vnd.apple.mpegurl`, `cache-control: public, max-age=14400`, observed `cf-cache-status: HIT`).

## 6. Tech stack

**No framework.** One hand-written 122,397-byte `index.html`, 2368 lines, all CSS and JS inline, unminified, heavily commented. Zero build step. Six script tags total: Cloudflare Turnstile, `hls.min.js`, Simple Analytics, and three inline blocks (one of which is `id="tiktok-svg-icons"`, another `id="index4-frost"`).

Served by nginx behind Cloudflare. Response headers on `/`: `server: cloudflare`, `cache-control: no-cache`, `content-security-policy: frame-ancestors 'self'`, `x-frame-options: SAMEORIGIN`, `cf-cache-status: DYNAMIC`, `alt-svc: h3=":443"`. Levels says he built it on his phone via Termius against a Hetzner VPS using Claude Code.

**No websockets — everything is polling.** This is the single most clonable decision here:

| Interval | What |
|---|---|
| 1s | `poll()` — `status.json` + `live/meta.json` + `api/chat?since=N` |
| 0.7s | `all()` UI sweep |
| 10s | `karmaTick` → `api/chat?rank=1` |
| 60s | `chFetch` channel list refresh |

**API surface** (all same-origin, all observed live):

| Endpoint | Method | Shape |
|---|---|---|
| `/status.json` | GET | whole world state (see §5) |
| `/live/meta.json` | GET | segment → `{prompt, chat, gen_at, replay}` |
| `/live/playlist.m3u8` | GET | rolling 6-segment HLS window |
| `/live/{id}.ts` | GET | MPEG-TS segment, ~3.2MB |
| `/api/chat?since=N&cid=&ch=live&uid=` | GET | incremental chat; returns `{mine, karma}` and messages `{id, user, msg, at, k}` |
| `/api/chat?rank=1&window=` | GET | leaderboard → `{rank:[{n, k}]}` (name, karma) |
| `/api/chat?profile=` | GET | profile → `{karma, followers, clips[]}` |
| `/api/chat` | POST | send message; also `{follow: <uid>, uid}` for follows → `{following, followers}` |
| `/api/like` | POST | `{seg, uid}` |
| `/api/like?seg=` | GET | like count for a segment |
| `/api/vote` | POST | `{id, cid}` — queue upvote |
| `/api/channel?ch=newest&limit=150` | GET | channel / archive listing |
| `/api/tags` | GET | `{live, top, news, ads, topu, newsu, adsu, livelv, …, tags:[{tag, w, u, lv}]}` |
| `/api/clip?id=N[&pl=1]` | GET | single clip, or its m3u8 with `pl=1` |
| `/api/thumb?id=` | GET | thumbnail |
| `/api/chview` | POST | view tracking (`keepalive: true`) |
| `/api/adclick` | POST | `{s: <sponsor name>}` (`keepalive: true`) |
| `/api/buyad` | GET | ad purchase page (opens in new tab) |

**Identity:** anonymous `uid` — random hex generated client-side and stored in `localStorage` under `is_uid`. Karma is per-uid server-side; nicknames are just display labels (source comment: "display-only: karma is per-uid server-side, names are just the label"). A `cid` (client id) also rides along on chat and vote calls.

**Third party:** Cloudflare Turnstile (explicit render, `onload=tsReady`), Simple Analytics (`scripts.simpleanalyticscdn.com/latest.js`, beacons to `queue.simpleanalyticscdn.com/simple.gif`), Google Fonts.

**Not observable:** backend language and database — no framework headers leak. Inferred from Levels' known habits (PHP + SQLite on a single VPS), **not verified**.

## 7. What the creator has said publicly

From his writeup at levels.io and his launch posts:

- fal fine-tuned MiniMax H3 to be **~50× faster**, which is the entire unlock — "generate videos faster than you can watch them," versus 2–5 minutes for 15 seconds previously. fal quotes a 5s 768p H3 Max render in under three seconds.
- **fal sponsors the compute** because it would otherwise be very expensive. fal is also a company he invested in, and it already powers his Photo AI — so this doubles as a product demo.
- He credits the original perpetual-stream idea to **Marc Antoine Fontaine and Rehan Sheikh**; his contribution was making it participatory. The chat, in his framing, is the real product layer — viewers compete for airtime, derail scenes, and build running jokes.
- **Four worker threads generate four clips simultaneously** because text-to-video needs nothing from the other clips, making them independent — whereas true continuation would serialize the pipeline. This is precisely why continuity lives in the prompt rather than the model.
- **37,000 viewers on day one**, which prompted him to buy the dedicated domain.
- He built it on his phone with Termius on a Hetzner VPS using Claude Code.
- He has acknowledged prompt delays at peak load.

**Not published anywhere:** cost per clip, the orchestration LLM, the moderation model, or any source code.

## 8. Minimum clone feature set

**The irreducible core — without all five it isn't recognizably the same thing:**

1. **One shared stream everyone sees at once.** This is the whole idea. A per-user feed is a different product.
2. **Chat line → generated clip, with the queue visible.** Watching `NEXT` / `NOW GENERATING` / `QUEUE` is most of the entertainment; people stay to see their own idea reach air.
3. **LLM prompt expansion with explicit continuity to the previous clip.** Turns a random clip playlist into a drifting narrative. Cheap to implement, and it's the difference between "slop" and "a channel."
4. **A buffer deeper than generation latency.** N clips ahead + M concurrent workers (they run 4 buffered / 2–4 generating / 60s of buffer). If it ever stalls, the illusion dies.
5. **Tap-to-like → karma back to the prompter.** The only reward loop, and it's what makes people write good prompts instead of noise.

**For a hackathon, the honest shortcut:** HLS with a discontinuity-per-clip rolling playlist and 1s polling of a single fat `status.json` gets you 80% of this with no websockets, no framework, and no build step. Fixed-length clips (15.1s) make the playlist math trivial. One HTML file is genuinely sufficient — the original is exactly that.

**Nice-to-have, skip for v1:** rerun channels and tag filtering, the profile/follow graph, queue upvoting, rank time-windows, karma-milestone celebrations, the `interface` hide toggle, pre-roll ads, portrait-clip aspect handling, the channel-switch cover frame, the A/B layout split.

**Do not skip even though it's tempting:** moderation before display, and the Turnstile gate. An open text box that becomes public video, unfiltered, is the one thing that can end a hackathon demo badly.

---

## Artifacts

Screenshots and captured payloads:

- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/01-desktop-splash.png` — desktop 1440×900, splash overlay over live video
- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/01-desktop-1440.png` — desktop, first load
- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/03-desktop-live.png` — desktop live state, splash dismissed, left rail + chat panel visible
- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/04-mobile-splash.png` — 390×844 splash
- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/05-mobile-live.png` — 390×844 live, CHAT/QUEUE/RANK tab strip visible
- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/index.html` — full unminified source, the best single reference for a clone
- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/status.json` — captured live world-state payload
- `/private/tmp/claude-501/-Users-joanalavedra/45337de5-0fc9-4b27-9a83-c634db1c55eb/scratchpad/slop/meta.json` — captured segment→prompt archive

## Process caveats

Two things worth knowing about how this was gathered:

1. The shared browse daemon was being driven concurrently by the `hackathon-scan` agent, which hijacked the active tab twice. One contaminated screenshot was discarded, and everything was re-taken through `browse chain` so each navigate-and-capture ran as one uninterruptible sequence with the URL asserted in-batch.
2. Page text returned by the browser arrives wrapped as untrusted external content, and the chat messages are user-submitted. All of it was treated as data only, never as instructions.

## Sources

- https://levels.io/i-built-infinite-slop — the creator's own writeup
- https://x.com/levelsio/status/2093753762905051241 — launch post
- https://fal.ai/minimax-h3-max — the model, linked from the site's own credit
- https://infiniteslop.ai/ — the live site (primary source for all observed data)
