# HTTP contract

Source of truth: `Status` in `src/mastra/channel.ts` and the routes in `src/mastra/index.ts`.
Dev server: `pnpm dev` → http://localhost:4111. Pages live in `src/mastra/public/` and are served by
explicit routes: viewer at `/`, broadcaster at `/broadcaster.html`. Mastra Studio is at `/studio`.
Custom routes cannot live under `/api` (Mastra reserves it).

## Viewer page (public)

| Route | Body / query | Response |
|---|---|---|
| `GET /status?uid=<uid>` | poll every 1 s; `uid` counts you as a viewer | `Status` (below) |
| `POST /say` | `{ uid, name, text, source?: "web"｜"voice", kind?: "new"｜"amend" }` | `200 {ok:true,id}` · `422 {ok:false,reason}` moderated out · `409 {ok:false,reason}` refused by the channel (see below) · `503` moderation down · `400` invalid |
| `POST /like` | `{ uid }` | `{ ok: boolean }` — false if already liked, own scene, or nothing on air |
| `GET /viewer-token` | — | `{ applicationId, sessionId, token }` subscribe-only Vonage token |
| `GET /announcer/:clipId` | — | `audio/mpeg`, the spoken "up next" line for one steer; 404 once forgotten |
| `GET /spend` | — | `SpendSnapshot` (below), the spend pill's data. Not under `/status`: that route is polled every second by every viewer, spend only needs a few-second cadence. |

`uid`: 8–64 chars of `[A-Za-z0-9_-]`, random, generated client-side, kept in `localStorage`.
`name`: 1–24 chars, moderated together with the idea. `text`: 1–280 chars.

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

```ts
interface SpendSnapshot {
  totalUsd: number;               // sum of the four byProvider.usd figures
  rates: {...};                   // the published/billed rate used for each provider, for the UI
  byProvider: {
    fal: { usd; seconds };              // Director open-session seconds
    nebius: { usd; inputTokens; outputTokens; calls };
    slng: { usd; audioSeconds; calls }; // TTS audio, mp3 bytes / 16000
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
  // scene on air; karma = its prompter's, live; amends = viewer amendments applied so far
  now: { ideaId; uid; name; text; prompt; airedAt; likes; karma; amends: { name; text }[] } | null;
  steering: { name; text; kind: "new" | "amend" } | null;            // sent to Director, not on screen yet (~20 s)
  queue: { id; name; text; karma; kind: "new" | "amend" }[];
  chat: { id; name; text; at; karma }[];                             // last 50
  rank: { name; karma }[];                                           // top 10
  ts: number;
}
```

`kind` on `steering`/`queue` items, and `now.amends`, are the "Yes, and" fields (see `POST /say`
above): `"amend"` means the item changes one thing about the scene on air rather than replacing it.

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
