# TeleSlop — build plan (HackBarna AI Summit 26)

Working name only. Do not ship under the "Infinite Slop" name or wordmark: it is a live product by a
real person, and the fal judges know it.

Research: `hackathon-report.md` and `slop-report.md` (copied next to this file).

## 0. Constraints

- Code freeze **Sun 20 Sep 11:00**. Venue closes Sat 23:00, reopens Sun 09:00. Demos Sun 14:00.
- Mentors with API keys are on-site only. **Collect every key before 23:00 tonight.**
- "Existing ideas are fine, existing code is not" (Mastra rule; organizers may ask for GitHub access).
  The saved `slop/index.html` is a behaviour reference. Do not copy code from it.
- Mastra's remote judge texts the bot Sunday afternoon; bot + stream must be up until **17:30 Sun**.
- Director promo ended 14 Sep: list price is $0.08/s = **$288/hour of stream, $4.80 minimum per
  session opened** (1080p is 2×; use 768p or 480p). Max session is 2 min or 15 min depending on which
  fal page you read. Ask fal mentors (Umut Günbak, Alper Bahçekapılı) for: credits with a number
  attached (≥ $500), the real session cap on our key and a raise, and whether a continuation handle
  exists. See `docs/cards/director.md`.

## 1. Concept

One shared AI TV channel everyone watches at once. Viewers say what airs next — from the web chat,
from Telegram, or by voice. Tap the screen to like; likes are karma for whoever prompted the scene.

The twist over the original (and what fal asks for: "a use of Director that a simple text-to-video
call couldn't achieve"): the original queues independent 15 s clips and fakes continuity in the
prompt. TeleSlop runs **one continuous Director session and steers it live**. The shot never cuts;
the scene morphs from one viewer's idea into the next. Queue, NOW/NEXT rail and karma stay.

## 2. Sponsor map — 7 challenges, one product

| Sponsor | Role in the product | Challenge bar | Effort |
|---|---|---|---|
| **fal** H3 Max Director | The channel's video, generated live and steered by chat | Director is the core; live not pre-rendered; browser-viewable; public repo + README + demo video | core |
| **Nebius** Token Factory | Showrunner LLM: moderates each idea, rewrites it into a steering prompt that transitions from the current scene | "used meaningfully… core functionality" | base-URL swap |
| **Mastra** | Backend framework. Showrunner agent + Telegram channel: text the bot an idea, it airs. Memory (your karma, your past scenes). Message-first: bot DMs "you're on air now" + link, and "your scene got 6 likes" | On Mastra Channels; ≥1 of remember / act / workflow / message-first; public repo; 60 s recording; live till 17:30 | core |
| **Vonage** Video API | Fan-out: one broadcaster tab receives Director's stream and publishes it into a Vonage session; every viewer subscribes. Live captions if time | Depth of API integration, scored /25 | 1–2 h, gated on spike |
| **SLNG** | TTS continuity announcer ("Up next, from Timba: a snake bursts out of a toilet"). STT hold-to-talk prompt input | SLNG "at the core"; running voice demo; latency/cost numbers | 1–2 h, needs keys |
| **Galtea** | Adversarial-test the showrunner's moderation (real people, NSFW, prompt injection). Find → fix → rerun | before/after results + **Tally survey is a hard gate** | 1 h |
| **QualityClouds** Norma | MCP scan → fix → rescan on the repo | one scan, ≥1 fix, one rescan; 2-min "defend your code" talk | 30 min |

Nebius + Mastra in one project is blessed in writing by both sponsors.

**Skipped:** Cognition/Devin (needs a programmatic verifier loop; nothing in this product is that —
forcing it costs hours), Norrsken wildfire (unrelated), Make (no challenge, no prize), Preply
(theme-only, prize TBA). **Stretch only:** Titan OS — a D-pad/voice "TV mode" is cheap, but their bar
is a conversational agent that *recommends* catalog content (TMDB); a TV skin alone does not qualify.
Only attempt with a third teammate who owns it end to end.

## 3. Architecture

```
Telegram ─┐                         ┌─ Nebius (moderate + rewrite)
web chat ─┼─> Mastra server (Node) ─┼─ SLNG TTS (announcer clip URL)
voice/STT ┘   queue, karma, state   └─ /api/fal/proxy (holds FAL_KEY, secret-gated)
                  │  GET /status (1 s poll)        ▲ GET /next-steer, POST /steer-result
                  ▼                                 │
             index.html  <── Vonage session <── broadcaster tab ══WebRTC══ fal Director
```

Director is WebRTC with exactly one consumer per session, and its steering call (`session.send`)
lives on the browser peer connection — Node cannot hold it. So the broadcaster tab is the only thing
that talks to Director, and Vonage fan-out is mandatory, not optional.

- **One Node 22 process** (Mastra). State in memory + one JSON file for karma.
  `ponytail: single process, in-memory queue; move to SQLite if it ever needs a second instance.`
- **One static `index.html`**, no framework, no build. Polls `/status` every second (the original
  does exactly this; no websockets). Full-bleed video, LIVE pill, caption bar, left rail
  NEXT / NOW / QUEUE, right CHAT / RANK, tap-to-like.
- **Steering loop, split in two.** Server side: pick the next approved idea (karma-weighted), ask
  Nebius for a transition prompt given the current scene, hold it at `GET /next-steer`.
  Broadcaster side: poll `/next-steer`, send at most one steer per ~25 s (measured steer-to-screen
  latency is 17–20 s), call
  `session.send({type:"prompt", prompt, prompt_version: ++v})`, report `prompt_applied` /
  `prompt_rejected` to `POST /steer-result`. Only on `prompt_applied` does the server update
  `/status`, DM the Telegram user, and cut the announcer line. `prompt_rejected: content_policy`
  feeds back into moderation (and is free Galtea evidence).
- **fal proxy**: `@fal-ai/server-proxy/express` (or hono) at `/api/fal/proxy`, gated by a shared
  secret header that only the broadcaster tab has. An open proxy lets any visitor open a $4.80 session.
- **SDK**: pin `@fal-ai/client@1.11.0-alpha.3` exactly. Stable 1.10.1 has no `./realtime` export.
- **Session rotation**: read `session_info.max_session_seconds` at runtime. ~15 s before the cap,
  grab the `<video>` frame to a canvas → `fal.storage.upload()` → open the next session with it as
  `image_url` and the current scene description as `prompt`. No documented continuation handle;
  expect a visible seam. If the cap is 2 min, mask it with a TV-style channel ident + announcer line.
- **Cost guard**: no viewers and empty queue → `{type:"stop"}`, loop Vonage-archived reruns.
  A Telegram message or a page view wakes it. At $288/h this decides whether the credits last.
- **Audio**: mix in the broadcaster tab with WebAudio (~10 lines): Director's audio track and the
  SLNG announcer `<audio>` both feed one `MediaStreamAudioDestinationNode`; duck Director's gain to
  0.3 while the announcer speaks; publish the mixed track. Every viewer hears the same thing in sync,
  no second autoplay element on viewer pages, and Vonage Live Captions (session audio only, on by
  default) caption the announcer for free.
- **Broadcaster tab**: one page on the laptop, opened with the secret in the URL hash.
  `OT.initPublisher({ videoSource, audioSource })`. Try Director's remote video track directly as
  `videoSource` first (no Vonage sample covers a remote WebRTC track); if it misbehaves, draw the
  `<video>` to a canvas and publish `canvas.captureStream(24).getVideoTracks()[0]`, which is
  Vonage's own documented sample. No `videoBitrate` option exists; the knobs are resolution,
  frameRate and `videoContentHint`.
  `ponytail: laptop tab; move to headless Chrome on the server if the laptop must close.`
- **Vonage**: `@vonage/server-sdk` 3.30.1 server-side (application ID + private key, not
  key/secret); `opentok.min.js` v2 from `video.standard.vonage.com` client-side. One routed session,
  15,000 connections, sub-second latency. Skip HLS broadcast (15–20 s lag would desync the chat rail).
  Archiving needs no account toggle (MP4, expires after 72 h) → that is the rerun loop's source.
  Free tier is 75,000 participant-minutes. See `docs/cards/vonage.md`.
- **Deploy**: Railway/Fly/Render, anything with a public URL. Telegram via long polling so no
  webhook setup. Not the Locatan Hetzner box.

## 4. Gate — Director spike: PASSED (Sat 18:17)

One 55 s session at 768p, measured in headless Chrome. Full numbers in `docs/cards/director.md`.

- Works, and works **headless** → the broadcaster can be headless Chrome on the server, not a laptop tab.
- Session cap on our key is **15 min** (`max_session_seconds: 900`).
- Steer → visible on screen takes **~17–20 s**. Cadence: one idea per ~25 s; the SLNG announcer fills
  the gap ("up next, from Timba…") so the wait reads as TV continuity, not lag.
- Subject and props persist across a steer. Continuity is the model's, not a prompt trick.
- fal proxy needs `wma.fal.run/**` added to its allow-list or every session fails with HTTP 400.
- Still untested: last-frame → `image_url` handover between sessions. Test when building rotation.

## 5. Build order

Cut from the bottom. Each step ends with something demoable.

**Sat 17:30–18:00 — keys.** Walk the floor: fal credits, Nebius key, Vonage key+secret, SLNG key and
the real hackathon guide URL (docs.slng.ai/hackathon is a 404), Galtea account, Norma MCP access.
Ask Zakee Abdi nothing; Devin is skipped.

**Sat 18:00–19:00 — spike (section 4)**, through dinner.

**Sat 19:00–21:00 — core loop.** `npm create mastra@latest`. Showrunner agent on Nebius via the model
router. Routes: `POST /say`, `POST /like`, `GET /status`. Steering loop → Director.
`index.html` with video + chat + rail. *Milestone: type an idea in the browser, watch the scene
change.*

**Sat 21:00–22:00 — Telegram.** Mastra Channels Telegram adapter, same `/say` path. Mastra memory
keyed by Telegram user. Message-first DMs (on-air, likes). *Milestone: text the bot from a phone,
get a DM when it airs.*

**Sat 22:00–23:00 — Vonage fan-out.** Broadcaster tab publishes, viewer page subscribes. Open the
page on two phones. *Milestone: two devices, same frame.*

**Sat night, at home — deploy + SLNG.** Deploy the server. Announcer TTS: server generates the line,
puts the audio URL in `/status`, clients play it in an `<audio>` element (no mixing). Hold-to-talk
STT → `/say`. Log per-turn latency for the SLNG write-up.

**Sun 09:00–10:00 — Galtea + Norma.** Details in `docs/cards/galtea-norma.md`.
Galtea: create the product + one-line spec in the web UI (the SDK cannot), spec = "turns viewer ideas
into safe video prompts; refuses real people, NSFW, and instructions aimed at itself". Python script
(`galtea==5.3.1`) whose agent function POSTs to our moderation endpoint; `type="SECURITY"` dataset
with a Custom threat for real people; `max_test_cases=20`, 2 metrics (~180 of 1,500 free credits).
Before/after = two Versions on the same dataset. Keep the failing case, fix the rubric prompt,
rerun, screenshot both. Fill the Tally survey.
Norma: there is no scan tool over MCP. Connect the GitHub repo at norma.qualityclouds.com and run
the **first Full Scan Saturday night** (5/week free) so Sunday is only fix → `register_applied_actions`
via MCP → second Full Scan. Note one finding accepted on purpose for the 2-min talk.

**Sun 10:00–11:00 — submit.** README (clone → first message), 60 s Telegram screen recording, demo
video of the stream being steered, repo public, submit. Nothing new after 10:00.

**Sun 11:00–14:00** — no code. Rehearse the pitch and the 2-min Norma talk. Keep the bot up.

## 6. Submission checklist

- [ ] Public GitHub repo, README that gets a stranger from clone to first message (Mastra, fal)
- [ ] README section: how Director is used and why a text-to-video call could not do it (fal)
- [ ] Demo video of the stream running and being steered (fal)
- [ ] Bot handle, 60 s recording of a real conversation, one line on who it's for (Mastra)
- [ ] Bot + stream live until 17:30 Sun; someone checks at 16:45 (Mastra tie-break is 17:00)
- [ ] Galtea before/after results + Tally survey https://tally.so/r/J9Pyar
- [ ] Norma scan → fix → rescan audit trail + 2-min talk
- [ ] SLNG: where it sits in the stack + latency/cost numbers
- [ ] Nebius: one paragraph on what Token Factory does in the product
- [ ] Global submission form — URL unknown, announced on-site; ask an organizer

## 7. Unverified — check before relying on it

- Director: real session cap on our key (2 vs 15 min), handover seam quality, steer latency
  (section 4). API shape, transport and steering call are now verified in `docs/cards/director.md`.
- Mastra: verified in `docs/cards/mastra-nebius.md` — Nebius is a built-in router provider
  (`nebius/<model>` + `NEBIUS_API_KEY`), Telegram long polling works (no webhook), `registerApiRoute()`
  + `src/mastra/public/` cover the routes and the static page, karma key = `telegram:<userId>`.
  Scaffold with `npx create-mastra@latest --empty`. Models: Qwen3-30B-A3B for moderation,
  GLM-5.3-Flash for rewriting; no guard model is hosted, so moderation is a rubric prompt.
- Mastra proactive DM: each half is documented, the join is not. Timebox 10 min, then fall back to a
  plain `api.telegram.org/bot<token>/sendMessage` fetch.
- SLNG: verified in `docs/cards/slng.md` — plain REST, `POST https://{region}.api.slng.ai/v1/tts|stt/
  {model-id}` with a Bearer key from app.slng.ai; STT accepts browser `webm/opus` blobs unchanged; use
  `slng/fish/tts:s2.1-pro` on `eu-west.api.slng.ai`. The docs' own example host `eu-west.slng.ai`
  does not resolve. Use `fetch`, skip the stale SDK, skip the voice-agent runtime and unmute (both
  only pay off for a conversational agent). Free credit amount is undocumented — ask the mentors.
- Vonage: a remote `RTCPeerConnection` track as `videoSource` is untested (canvas fallback is
  documented); `@vonage/video` option shapes need checking against its `.d.ts`.
- Whether Cognition requires open source (irrelevant while Devin is skipped).
