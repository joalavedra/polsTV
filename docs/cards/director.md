# fal H3 Max Director — API card (verified 2026-09-19)

Sources: [model page](https://fal.ai/models/minimax/h3-max/director) · [API tab](https://fal.ai/models/minimax/h3-max/director/api) ·
[learn page](https://fal.ai/learn/tools/what-is-minimax-h3-max-director) · npm registry · local install of `@fal-ai/client@1.11.0-alpha.3`.
Everything below is VERIFIED unless tagged otherwise. Two numbers CONFLICT between fal's own pages — flagged, ask the mentors.

## 1. Transport — one consumer per session. Vonage fan-out is REQUIRED.

- VERIFIED: **WebRTC**, not a URL. Media arrives as live `MediaStream` tracks; the docs' own caveat is that it
  "doesn't return an mp4 file URL". 24 fps, 10 s chunks, Opus audio.
- VERIFIED (`@fal-ai/client/src/realtime/wma.js` contains `new RTCPeerConnection` / `new MediaStream`): the session IS a
  browser peer connection. `onMedia: (stream) => video.srcObject = stream`.
- VERIFIED: **exactly one consumer.** One SDP offer, one peer connection, one session id. There is no published
  subscriber/viewer endpoint. `session_info.one_session_per_machine = true`; "parallel sessions need parallel machines".
- **Consequence for PLAN §3:** the architecture as drawn is correct — broadcaster tab + Vonage fan-out is not optional,
  it is the only way >1 viewer sees the stream. Vonage does NOT drop to captions-only.
- Use `OT.initPublisher({ videoSource: track, audioSource: track })` with the tracks off that `MediaStream`; no
  `canvas.captureStream()` needed. UNVERIFIED (Vonage side, not fal's docs).

## 2. Opening and steering a session

Endpoint id: `minimax/h3-max/director`. Auth: `FAL_KEY` server-side only — "The browser connects through your server
proxy, which reads `FAL_KEY` from the server environment. **Never put that key in browser code.**" (VERIFIED, API tab.)

**configure** (client→server, once; these fields are immutable for the session's life):
```json
{ "type": "configure", "protocol_version": 1, "prompt_version": 1,
  "prompt": "...", "resolution": "480p|768p|1080p", "aspect_ratio": "16:9|9:16|1:1",
  "memory": 12, "image_url": "...", "end_image_url": "...", "audio_url": "...",
  "audio_bitrate": 96000, "seed": "...", "script": [...] }
```
`prompt` up to 50,000 chars. `memory` = prior segment prompts kept as context, 1–50, default 12.

**prompt** (client→server, THE steering call — send as often as you like):
```json
{ "type": "prompt", "prompt": "They follow a narrow path down to the harbor.", "prompt_version": 2 }
```
Also accepts `end_image_url`, `audio_url`, `audio_behavior` (`replace|queue`), `replan` (bool), `script`,
`script_mode` (`replace|append`). `prompt_version` must strictly increase; a stale one is rejected.
Other client messages: `{"type":"stop"}`, `{"type":"ping","ts":0}`.

**Server→client:** `configured`, `prompt_pending`, `prompt_applied`, `prompt_rejected`, `chunk`, `audio_applied`,
`audio_rejected`, `audio_pending`, `audio_exhausted`, `stream_exhausted`, `deadline_missed`, `chunk_metrics`,
`session_metrics`, `session_info`, `error`, `pong`.
`prompt_rejected.reason` ∈ `content_policy | preparation_failed | stale_prompt_version | invalid_script |
infeasible_timing | invalid_audio | invalid_image | queue_full` — **wire `content_policy` into the showrunner's
moderation feedback; it is free adversarial signal for Galtea.**
`error.code` ∈ `balance_unavailable | content_policy | configuration_timeout | generation_failed | generation_timeout |
immutable_settings | initialization_timeout | invalid_initial_image | invalid_initial_audio | invalid_initial_script |
invalid_input | invalid_message | not_configured | stale_prompt_version`.

**Can the Mastra server steer? Not directly.** VERIFIED: `send()` is a method on the WebRTC session object, over that
session's data channel. Node 22 has no `RTCPeerConnection`. So the steering loop must either live in the broadcaster
tab, or run in Node behind a WebRTC polyfill (`@roamhq/wrtc`) / headless Chrome — UNVERIFIED, untested, and a hackathon
time sink. **Recommendation: keep queue/karma/moderation in Mastra, expose `GET /next-steer`, and let the broadcaster
tab poll it and call `session.send(...)`.** That is a ~10-line change to PLAN §3 and removes the only unknown.

**Keys off the browser:** `@fal-ai/server-proxy` (v1.2.1), exports `./express`, `./hono`, `./nextjs`, `./remix`,
`./svelte` (VERIFIED by install — Express/Hono adapters exist, so no Next.js needed). The WebRTC SDP exchange goes
through `proxyUrl` too. fal's own warning: "Authenticate users before allowing them to call your proxy route so other
people cannot spend against your account." **With an open proxy, any page visitor can open a $4.80 session. Gate it.**

## 3. Session limits, expiry, handover

- **CONFLICT — ask Umut/Alper.** Model page: "Default session length: up to 15 minutes". Learn page: "Sessions run up
  to 2 minutes by default". Both agree "longer sessions are available for approved use cases on request".
  PLAN §3 assumes 15 min rotation. **If it is really 2 min, rotation happens 7× more often — this is the single
  highest-value question to ask on the floor. Ask for the limit to be raised on the hackathon key either way.**
- `session_info.max_session_seconds` exists, default `null` (VERIFIED) — read it off the live `session_info` message at
  runtime and trust that over both docs pages.
- Expiry: server sends `{"type":"stream_exhausted","reason":"session_limit","chunks":N}` (VERIFIED). `reason` is
  `stopped | session_limit`.
- **Seamless handover: NOT DOCUMENTED.** There is no session-id continuation, no "resume from previous session", and no
  API that returns the last frame. `image_url` (first frame) is configure-only and immutable, so a new session CAN be
  seeded with an image — but you must produce that image yourself (grab the last `<video>` frame to a canvas →
  `fal.storage.upload()` → pass as `image_url`). Carry the scene description forward in the new `prompt`.
  UNVERIFIED that this looks seamless. Ask the mentors whether a continuation handle exists.
- Backpressure: on underrun the server sends `deadline_missed` with behaviour fixed to
  `freeze_video_and_silence_audio_until_ready` — video freezes, audio goes silent. Not configurable.
- `session_info` constants (VERIFIED): `fps` 24, `chunk_seconds` 10, chunk duration 5–15 s (default 10),
  `continuation_context_frames` 39, `continuation_playback_seconds` 8.5, `script_max_beats` 64,
  `max_audio_source_seconds` 600, `default_memory` 12 (1–50).

## 4. Audio — yes.

VERIFIED: native audio out over WebRTC/Opus, bitrate `96000 | 128000 | 192000`. `audio_url` supplies a startup
soundtrack; live `prompt` messages can `replace` or `queue` more audio via `audio_behavior`.
Sample rate CONFLICT: `session_info.audio_sample_rate = 48000` vs learn page "32000 Hz" — irrelevant for us.
**Impact on PLAN §2:** SLNG is no longer the channel's only sound. Either mute Director's audio track and let SLNG own
the soundtrack, or duck it. Decide before wiring Vonage, because you publish the track either way.

## 5. Pricing — PLAN's $72/hour is probably stale.

- Model page: "$0.02 per second" promo, "list price after Sep 14: $0.08 per second", 1080p = 2× rate,
  "minimum charge $1.20 per session".
- Learn page: "$0.08 per second of video generated", "every session is billed at a 60-second minimum" (= $4.80).
- Reconciled: min charge is **60 s of generated video**, so $1.20 at promo and $4.80 at list. Both pages agree on that.
- **Today is 2026-09-19, past the Sep 14 promo end → assume $0.08/s = $288/hour of stream, and $4.80 per session
  opened.** Every 15-min rotation costs $72; at a 2-min cap, ~$9.60 per rotation. PLAN §0's $72/hour figure and the
  cost-guard maths need redoing. **Get credits with a hard number attached, and keep the idle-shutdown guard — at
  $288/hr it is the difference between finishing the weekend and not.**

## 6. Packages (checked against the npm registry today, not memory)

| package | latest stable | note |
|---|---|---|
| `@fal-ai/client` | **1.10.1** (published 2026-09-08) | **stable does NOT export `./realtime`** — verified via `npm view … exports` |
| `@fal-ai/client` | **1.11.0-alpha.3** | exports `./realtime`, `./realtime/wma`, `./realtime/websocket`, `./realtime/ice` |
| `@fal-ai/server-proxy` | **1.2.1** | express / hono / nextjs / remix / svelte adapters |

**Gotcha, and it will cost you 20 minutes if you hit it cold: you must install the alpha.**
`npm i @fal-ai/client@1.11.0-alpha.3`. The whole `fal.realtime.open()` extension API is tagged `@experimental — may
change in a minor release` in its own type definitions. Pin the exact alpha version; do not use a range.

## 7. Minimal working snippet

Server (Node 22 ESM TS) — keeps `FAL_KEY` off the browser:
```ts
// server.ts — needs FAL_KEY in env
import express from "express";
import { route } from "@fal-ai/server-proxy/express";

const app = express();
app.all("/api/fal/proxy", route); // TODO gate this: an open proxy spends your credits
app.listen(3000);
```

Browser (plain JS, served from the same origin):
```js
import { createFalClient } from "@fal-ai/client";
import { wma } from "@fal-ai/client/realtime";

const fal = createFalClient({ proxyUrl: "/api/fal/proxy" });

const session = fal.realtime.open(wma("minimax/h3-max/director"), {
  receive: ["video", "audio"],
  onMedia: (stream) => { document.querySelector("video").srcObject = stream; },
  onData: (raw) => { const m = JSON.parse(raw); console.log(m.type, m); },
});

session.send({ type: "configure", protocol_version: 1, prompt_version: 1,
  resolution: "768p", aspect_ratio: "16:9", memory: 12,
  prompt: "A continuous live-action sitcom about adult roommates. Preserve appearances and layouts." });

// steer — after `configured`, any time, prompt_version strictly increasing
session.send({ type: "prompt", prompt: "They follow a narrow path down to the harbor.", prompt_version: 2 });
```
The `createFalClient` + `wma()` + `configure` shape is VERIFIED verbatim from the playground sample on the API tab.
`onData`/`JSON.parse` is UNVERIFIED in detail — the SDK types describe `onData` as a raw string; confirm the framing
(JSON vs msgpack) on the first run, it is a one-line fix either way.

## 8. Gotchas

1. **Alpha-only SDK** (§6) — the stable client cannot do this at all.
2. **One consumer per session** (§1) — no fan-out without Vonage.
3. **Steering needs the peer connection** (§2) — Node can't hold it; move the loop to the broadcaster tab.
4. **`resolution`, `aspect_ratio`, `image_url`, `memory`, `seed` are immutable** after `configure`; changing them
   returns `error.code = immutable_settings`. Rotate the session to change them.
5. **`prompt_version` must strictly increase** — a single reused int silently stalls steering (`stale_prompt_version`).
6. **No mp4 out.** Recording the demo video means screen-recording the browser.
7. **$4.80 floor per session opened** — reconnect loops are expensive; don't retry blindly.
8. **No documented rate limit**, but `one_session_per_machine` and `prompt_rejected.reason = queue_full` exist. Ask.
9. **`script` is incompatible with `end_image_url` / `audio_url`** at configure time (model page).

## Ask the fal mentors (Umut Günbak, Alper Bahçekapılı)

1. Real max session length on our key — 2 min or 15 min? Can you raise it for the hackathon?
2. Is there any session continuation handle, or is last-frame → `image_url` the only handover?
3. Current price and whether hackathon credits are on the promo rate.
4. Is `@fal-ai/client@1.11.0-alpha.3` the version you want us on?

## Spike results — ran 2026-09-19 18:17, one 55 s session at 768p (code in `spike/`)

All MEASURED on our key, in headless Chrome 145 driven by a script. Supersedes the conflicts above.

- **It works, and it works headless.** The broadcaster does not need a laptop tab; headless Chrome on a
  server can hold the session (H264/VP8/VP9/AV1 + Opus all available).
- **`max_session_seconds: 900`** on our key → the cap is 15 min, not 2. Rotation = 4 seams/hour.
- **Proxy gotcha:** `@fal-ai/server-proxy`'s default allow-list lacks the signalling bridge. Without
  `allowedUrlPatterns: [...DEFAULT_ALLOWED_URL_PATTERNS, "wma.fal.run/**"]` the proxy itself answers
  400 "Invalid request" and the SDK reports "WMA session request failed (HTTP 400)". No charge occurs.
- **No bundler needed:** `https://esm.sh/@fal-ai/client@1.11.0-alpha.3` and `.../realtime` import fine.
- **`onData` is a JSON string.** `JSON.parse` works on every message.
- **Timings:** session `live` 5.2 s after open, first frame on screen 11.5 s. Each chunk is 8.5 s of
  playback and took 4.9–7.7 s to generate; the server keeps ~2 chunks buffered.
- **Steer latency:** `prompt` → `prompt_pending` 0.1 s → `prompt_applied` 8.0 s → first chunk carrying
  the new version 12.8 s → **visible on screen ~17–20 s after the send.** Plan the steering cadence
  around one idea per ~10 s, and fill the gap with the announcer ("up next, from Timba…").
- **Continuity is real:** same subject and props carried across the steer (capybara + rubber duck
  walked from the kitchen through a door into the arcade). See `spike/frames/contact.jpg`.
- Output is 1344×768 with a live audio track.
- `{type:"stop"}` → `stream_exhausted {reason:"stopped"}`, then the SDK fires `onError("control data
  channel closed…")`. Benign after a deliberate stop; do not treat it as a failure or retry on it.
- NOT tested yet: last-frame → `image_url` session handover (costs another session minimum).
