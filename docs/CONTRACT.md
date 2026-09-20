# HTTP contract

Source of truth: `Status` in `src/mastra/channel.ts` and the routes in `src/mastra/index.ts`.
Dev server: `pnpm dev` → http://localhost:4111. Pages live in `src/mastra/public/` and are served by
explicit routes: viewer at `/`, broadcaster at `/broadcaster.html`. Mastra Studio is at `/studio`.
Custom routes cannot live under `/api` (Mastra reserves it).

## Viewer page (public)

| Route | Body / query | Response |
|---|---|---|
| `GET /status?uid=<uid>` | poll every 1 s; `uid` counts you as a viewer | `Status` (below) |
| `GET /me?uid=<uid>` | — | `{ karma, pitchCooldownSeconds }` for one viewer. Not folded into `/status`: that route is polled every second by every viewer, this one is only needed when the pitch button has to know where you stand. `400` on an invalid uid. |
| `POST /say` | `{ uid, name, text, source?: "web"｜"voice", kind?: "new"｜"amend" }` | `200 {ok:true,id}` · `422 {ok:false,reason}` moderated out · `409 {ok:false,reason}` refused by the channel (see below) · `503` moderation down · `400` invalid |
| `POST /say` | `{ uid, name, text, source?: "web"｜"voice" }` | `200 {ok:true,id}` · `422 {ok:false,reason}` moderated out · `409 {ok:false,reason}` already queued · `503` moderation down · `400` invalid |
| `POST /say-voice` | `multipart/form-data`: `uid`, `name`, `audio` (blob) | same codes as `/say` (with `source: "voice"`), plus `415 {ok:false,reason}` bad audio type/size and `422 {ok:false,reason,heard}` when nothing was heard; every response from this route that has a transcript includes `heard: "<transcript>"` |
| `POST /pitch` | `{ uid, name, brief }` | `200 {ok:true,line}` — `line` is the ad read the voice will speak, open to any viewer · `429` per-user cooldown (30 s) or rate limit · `409` another pitch has the slot · `422` moderated out · `503` moderation, writing or TTS down · `400` invalid. Every failure carries `{ok:false,code,reason}`. |
| `POST /like` | `{ uid }` | `{ ok: boolean }` — false if already liked, own scene, or nothing on air |
| `GET /viewer-token` | — | `{ applicationId, sessionId, token }` subscribe-only Vonage token |
| `GET /announcer/:clipId` | — | `audio/mpeg`, one spoken clip: the ad read for a steer whose idea asked for an ad, or a pitch's ad read; 404 once forgotten |
| `GET /spend` | — | `SpendSnapshot` (below), the spend pill's data. Not under `/status`: that route is polled every second by every viewer, spend only needs a few-second cadence. |
| `GET /ticker` | — | `{ items: [{ id, name, caption, url }] }`, the images currently on the ticker (newest last). `url` is page-relative (`ticker/<id>`, no leading slash — the app is served under `/polstv/` in production). |
| `GET /ticker/:id` | — | The image bytes, with the right `content-type` and `cache-control: public, max-age=600`. `404` once the item is unknown or has expired. |

`uid`: 8–64 chars of `[A-Za-z0-9_-]`, random, generated client-side, kept in `localStorage`.
`name`: 1–24 chars, moderated together with the idea. `text`: 1–280 chars.
`brief`: 1–140 chars, moderated with the name against a separate pitch rubric. A real company,
brand, product, price, discount or offer is allowed (a sponsor, the viewer's own startup); real
people, health/financial/legal/safety claims, age-restricted or illegal goods, scams, and contact
details are refused.

`kind` (default `"new"`): `"new"` replaces the scene on air, same as before. `"amend"` is "Yes, and" —
it changes ONE thing about the scene already on air while everything else keeps running, instead of
queuing a fresh one. Moderated exactly like a `"new"` idea. `409` reasons unique to an amend:
- `"Nothing is on air to change yet; send an idea first."` — no scene is on air (`status().now` is
  null).
- `"This scene has had its three changes; send a new idea."` — the scene on air already has
  `MAX_AMENDS_PER_SCENE` (3) applied amends.
An accepted amend is tagged with the scene it targets. If that scene is no longer on air by the time
the amend's turn comes up, the broadcaster's next `next-steer` poll silently drops it (never applies
it to a different scene) and moves on to the next queued item — the submitter sees nothing beyond
their idea quietly never airing.
`/say-voice`'s `uid`/`name` follow the same rules as `/say`, reused not redeclared. `audio`: 1 KB–1.5
MB, declared type one of `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/wav` (Safari's `audio/mp4`
recordings are accepted — verified live against SLNG, docs/cards/slng.md, src/mastra/transcriber.ts).
The same per-client rate limit as `/say` applies before the SLNG call, since each call costs money.
The route: validate the boundary → rate limit → transcribe on SLNG (`transcriber.ts`) → trim → if
under 3 characters, `422` with the reason above → otherwise the idea runs through the exact same
moderated path as `/say` (`handleSay` in `say.ts`), with `source: "voice"`.

```ts
interface SpendSnapshot {
  totalUsd: number;               // sum of the four byProvider.usd figures
  rates: {...};                   // the published/billed rate used for each provider, for the UI
  byProvider: {
    fal: { usd; seconds };              // Director open-session seconds
    nebius: { usd; inputTokens; outputTokens; calls };
    slng: { usd; audioSeconds; calls }; // TTS output + STT input audio, pooled
    vonage: { usd; participantMinutes };
  };
  scenes: { ideaId; name; text; usd; byProvider }[];  // last 8 aired scenes, newest first
  notAired: { usd };               // moderation/steer-write/TTS cost of ideas that never aired
  idle: { usd };                   // fal/Vonage time while nothing was on air
  pitches: { usd };                // sponsored voice-overs: they have no scene of their own
  ticker: { usd };                 // Nebius cost of ticker photo/caption moderation
}
```

Every figure is an ESTIMATE computed from src/mastra/spend.ts's published rate constants, not a
real invoice. `scenes` is a rolling window of the last 8 aired scenes; once a 9th airs, the oldest
drops out of this list but its cost stays folded into `byProvider`/`totalUsd` — so
`sum(scenes[].usd) + notAired.usd + idle.usd + pitches.usd + ticker.usd` only equals `totalUsd`
while 8 or fewer scenes have aired in this process's lifetime.

```ts
interface Status {
  live: boolean;            // broadcaster polled within the last 15 s
  viewers: number;
  // scene on air; karma = its prompter's, live; amends = viewer amendments applied so far
  now: { ideaId; uid; name; text; prompt; airedAt; likes; karma; amends: { name; text }[] } | null;
  steering: { name; text; kind: "new" | "amend" } | null;            // sent to Director, not on screen yet (~20 s)
  queue: { id; name; text; karma; kind: "new" | "amend" }[];
  chat: { id; name; text; at; karma }[];                             // last 50
  rank: { name; karma }[];                                           // top 10
  pitch: { name; brief; state } | null;  // sponsored voice-over waiting, playing, or just dropped
  ad: { line; endsAt } | null;           // on-screen AD banner: the line airing now, and when it ends
  ts: number;
}
```

`kind` on `steering`/`queue` items, and `now.amends`, are the "Yes, and" fields (see `POST /say`
above): `"amend"` means the item changes one thing about the scene on air rather than replacing it.

`pitch.state` is `"pending"` (written, waiting for the broadcaster), `"playing"`, or `"dropped"`
(nobody collected it within 60 s — shown for a few seconds so viewers see it never aired). The
field is `null` the rest of the time, including while the ad read is still being written.

`ad` is set by `POST /b/:secret/clip-started` (below) the moment the broadcaster actually starts
playing a clip, and clears itself once that clip's own real duration has passed, plus half a
second of grace (`src/mastra/ad-banner.ts`) — there is no fixed length or hard stop, so the banner
and the voice always go quiet together. `null` the rest of the time, including the whole
`AD_CLIP_DELAY_MS` (17 s) gap between a steer landing and its ad read actually starting.

## Broadcaster page (secret in the path; wrong secret → 404)

| Route | Response |
|---|---|
| `GET /b/:secret/publisher-token` | `{ applicationId, sessionId, token }` publish-capable |
| `GET /b/:secret/next-steer?director=1` | `200 { steerId, ideaId, prompt, announcerUrl?, pitch? }` or `204`. `announcerUrl` is a page-relative mp3 path (`announcer/<id>`) to mix into the stream when the steer is sent — present only when the idea's text reads as a request for an ad (`isAdIdea`, `showrunner.ts`); absent for every other idea, if the ad write times out or fails or comes back empty, if TTS fails, and always for a `kind: "amend"` steer. Idempotent: the same steer is returned until resolved. Doubles as the broadcaster heartbeat, so poll it every ~3 s. `?director=1` (broadcaster.html sends it while its Director session is OPENING/LIVE/ROTATING) tells the server to meter fal seconds on this heartbeat; Vonage participant-minutes accrue on every poll regardless. See `GET /spend`. |
| | `pitch` is `{ pitchId, name, url }`, a sponsored voice-over waiting for the air. It rides along with whatever the poll was going to answer — including a poll that would otherwise be `204`, which becomes a `200` carrying only `pitch`. Handed out exactly once, so act on it in the same poll; unlike the steer it is NOT repeated. Queue it behind any clip still playing and report the outcome. |
| `POST /b/:secret/steer-result` | body `{ steerId, applied, reason? }` → `{ ok, onAir }`. Send `applied:true` on Director's `prompt_applied`, `false` on `prompt_rejected`. |
| `POST /b/:secret/pitch-result` | body `{ pitchId, played, reason? }` → `{ ok }`. Frees the pitch slot either way. A pitch nobody reports on is dropped 60 s after it was handed out. |
| `POST /b/:secret/clip-started` | body `{ clipId, seconds }` → `{ ok }`. Sent the moment a clip actually starts playing (fire-and-forget from the broadcaster's side). `seconds` is the clip's real length; sets `status.ad` to that clip's line until `seconds` have passed (plus 500ms grace). A missing or out-of-range `seconds` (not `> 0` and `<= 60`) falls back to 10 rather than failing the request, so an old broadcaster tab cannot break the route. `404` on an unknown or already-forgotten `clipId`, `400` on a malformed body. |
| `ALL /b/:secret/fal-proxy` | fal client `proxyUrl`. Holds `FAL_KEY` server-side. |
| `POST /b/:secret/eval` | body `{ name, text }` → `200 { ok: true, reason: "", prompt }` when accepted, `200 { ok: false, reason }` when moderation refuses, `503 { ok: false, reason }` when the moderator or scene writer fails · `400` invalid. Runs `moderate(text, name)` and, when accepted, `writeSteer(undefined, text)` exactly as `/say` would, with no side effects: nothing is queued, nothing airs, no TTS runs. The evaluation hook for external red-teaming (Galtea); see `src/mastra/eval.ts`. |

`steerId` is the server's id. It is seeded from the clock at boot, not from 1, so a restarted
server never hands out an id the broadcaster page has already acted on and dropped as a duplicate
(`channel.ts`). The same holds for `ideaId` and `pitchId`. A steer nobody reports on within 90 s
(`STEER_TIMEOUT_MS`) is abandoned with an operator log line and its idea dropped, so a lost
`steer-result` cannot wedge the queue for the rest of the broadcast.

Director's `prompt_version` is the broadcaster's own counter, strictly increasing per Director
session, starting at 1 with `configure`.

Opening prompt for a new Director session: `status.now?.prompt`, or a channel-ident prompt when null.
