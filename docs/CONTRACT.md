# HTTP contract

Source of truth: `Status` in `src/mastra/channel.ts` and the routes in `src/mastra/index.ts`.
Dev server: `pnpm dev` → http://localhost:4111. Pages live in `src/mastra/public/` and are served by
explicit routes: viewer at `/`, broadcaster at `/broadcaster.html`. Mastra Studio is at `/studio`.
Custom routes cannot live under `/api` (Mastra reserves it).

## Viewer page (public)

| Route | Body / query | Response |
|---|---|---|
| `GET /status?uid=<uid>` | poll every 1 s; `uid` counts you as a viewer | `Status` (below) |
| `POST /say` | `{ uid, name, text, source?: "web"｜"voice" }` | `200 {ok:true,id}` · `422 {ok:false,reason}` moderated out · `409 {ok:false,reason}` already queued · `503` moderation down · `400` invalid |
| `POST /say-voice` | `multipart/form-data`: `uid`, `name`, `audio` (blob) | same codes as `/say` (with `source: "voice"`), plus `415 {ok:false,reason}` bad audio type/size and `422 {ok:false,reason,heard}` when nothing was heard; every response from this route that has a transcript includes `heard: "<transcript>"` |
| `POST /like` | `{ uid }` | `{ ok: boolean }` — false if already liked, own scene, or nothing on air |
| `GET /viewer-token` | — | `{ applicationId, sessionId, token }` subscribe-only Vonage token |
| `GET /announcer/:clipId` | — | `audio/mpeg`, the spoken "up next" line for one steer; 404 once forgotten |
| `GET /spend` | — | `SpendSnapshot` (below), the spend pill's data. Not under `/status`: that route is polled every second by every viewer, spend only needs a few-second cadence. |

`uid`: 8–64 chars of `[A-Za-z0-9_-]`, random, generated client-side, kept in `localStorage`.
`name`: 1–24 chars, moderated together with the idea. `text`: 1–280 chars.

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
}
```

Every figure is an ESTIMATE computed from src/mastra/spend.ts's published rate constants, not a
real invoice. `scenes` is a rolling window of the last 8 aired scenes; once a 9th airs, the oldest
drops out of this list but its cost stays folded into `byProvider`/`totalUsd` — so
`sum(scenes[].usd) + notAired.usd + idle.usd` only equals `totalUsd` while 8 or fewer scenes have
aired in this process's lifetime.

```ts
interface Status {
  live: boolean;            // broadcaster polled within the last 15 s
  viewers: number;
  now: { ideaId; uid; name; text; prompt; airedAt; likes; karma } | null; // scene on air; karma = its prompter's, live
  steering: { name; text } | null;                                   // sent to Director, not on screen yet (~20 s)
  queue: { id; name; text; karma }[];
  chat: { id; name; text; at; karma }[];                             // last 50
  rank: { name; karma }[];                                           // top 10
  ts: number;
}
```

## Broadcaster page (secret in the path; wrong secret → 404)

| Route | Response |
|---|---|
| `GET /b/:secret/publisher-token` | `{ applicationId, sessionId, token }` publish-capable |
| `GET /b/:secret/next-steer?director=1` | `200 { steerId, ideaId, prompt, announcerUrl? }` or `204`. `announcerUrl` is a page-relative mp3 path (`announcer/<id>`) to mix into the stream when the steer is sent; absent if TTS failed. Idempotent: the same steer is returned until resolved. Doubles as the broadcaster heartbeat, so poll it every ~3 s. `?director=1` (broadcaster.html sends it while its Director session is OPENING/LIVE/ROTATING) tells the server to meter fal seconds on this heartbeat; Vonage participant-minutes accrue on every poll regardless. See `GET /spend`. |
| `POST /b/:secret/steer-result` | body `{ steerId, applied, reason? }` → `{ ok, onAir }`. Send `applied:true` on Director's `prompt_applied`, `false` on `prompt_rejected`. |
| `ALL /b/:secret/fal-proxy` | fal client `proxyUrl`. Holds `FAL_KEY` server-side. |

`steerId` is the server's id. Director's `prompt_version` is the broadcaster's own counter, strictly
increasing per Director session, starting at 1 with `configure`.

Opening prompt for a new Director session: `status.now?.prompt`, or a channel-ident prompt when null.
