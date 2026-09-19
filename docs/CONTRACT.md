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
| `POST /like` | `{ uid }` | `{ ok: boolean }` — false if already liked, own scene, or nothing on air |
| `GET /viewer-token` | — | `{ applicationId, sessionId, token }` subscribe-only Vonage token |
| `GET /announcer/:clipId` | — | `audio/mpeg`, the spoken "up next" line for one steer; 404 once forgotten |

`uid`: 8–64 chars of `[A-Za-z0-9_-]`, random, generated client-side, kept in `localStorage`.
`name`: 1–24 chars, moderated together with the idea. `text`: 1–280 chars.

```ts
interface Status {
  live: boolean;            // broadcaster polled within the last 15 s
  viewers: number;
  now: { ideaId; uid; name; text; prompt; airedAt; likes } | null;   // scene on air
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
| `GET /b/:secret/next-steer` | `200 { steerId, ideaId, prompt, announcerUrl? }` or `204`. `announcerUrl` is a same-origin mp3 to mix into the stream when the steer is sent; absent if TTS failed. Idempotent: the same steer is returned until resolved. Doubles as the broadcaster heartbeat, so poll it every ~3 s. |
| `POST /b/:secret/steer-result` | body `{ steerId, applied, reason? }` → `{ ok, onAir }`. Send `applied:true` on Director's `prompt_applied`, `false` on `prompt_rejected`. |
| `ALL /b/:secret/fal-proxy` | fal client `proxyUrl`. Holds `FAL_KEY` server-side. |

`steerId` is the server's id. Director's `prompt_version` is the broadcaster's own counter, strictly
increasing per Director session, starting at 1 with `configure`.

Opening prompt for a new Director session: `status.now?.prompt`, or a channel-ident prompt when null.
