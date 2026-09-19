# Mastra + Nebius — verified 2026-09-19 (V = verified vs linked source; U = unverified, check first)

## 8. Versions (V — `npm view`, 2026-09-19)

`mastra` 1.30.0 · `create-mastra` 1.30.0 · `@mastra/core` 1.67.0 · `@mastra/memory` 1.30.0 ·
`@mastra/libsql` 1.23.0 · `@mastra/deployer` 1.67.0 · `@chat-adapter/telegram` 4.41.0

## 1. Scaffold, dev, build, deploy

- V `npx create-mastra@latest`. Flags: `--llm <openai|anthropic|google|xai>`, `--template`,
  `--empty` (bare project, no agents/SDK deps), `--no-skills`, `--no-git`, `--no-install`. Default
  starter ships "agent harness with workspace tools, memory, task tracking, web access, recurring
  schedules, storage, and observability". Name must be lowercase, target dir must not exist.
  (https://mastra.ai/reference/cli/create-mastra)
  → **Use `--empty`.** Nebius is not a `--llm` choice anyway, so the key goes in `.env` by hand.
- V `mastra build` → `.mastra/output/` (`index.mjs`, `mastra.mjs`, `tools.mjs`, `package.json`,
  `node_modules/`, `public/`). "The `output` directory is self-contained. You can copy it to any
  server and run it directly." Build step 5: "Creates a Hono-based HTTP server as `index.mjs`."
  (https://mastra.ai/docs/deployment/mastra-server)
- V Start: `mastra start` (loads `.env.production` + `.env`, graceful shutdown) or
  `node .mastra/output/index.mjs`. `PORT` env var, default `4111`.
- V Railway/Fly/Render: no per-host guide, no Dockerfile in docs. Build `mastra build`, start
  `mastra start`; they inject `PORT`. U `mastra dev` — `/reference/cli/dev.md` 404s; read the
  scaffolded `package.json` for the dev script.

## 2. Nebius as the model

**V — Nebius IS a built-in router provider.** No custom OpenAI-compatible provider needed.
(https://mastra.ai/models/providers/nebius)

```typescript
import { Agent } from "@mastra/core/agent";
const agent = new Agent({
  id: "my-agent", name: "My Agent",
  instructions: "You are a helpful assistant",
  model: "nebius/MiniMaxAI/MiniMax-M3"        // NEBIUS_API_KEY read automatically
});
```

V Mastra calls the OpenAI-compatible `/chat/completions` endpoint, so "some provider-specific
features may not be available". V Pin the URL only for custom headers:
`model: { url: "https://api.tokenfactory.nebius.com/v1", id: "nebius/MiniMaxAI/MiniMax-M3",
apiKey: process.env.NEBIUS_API_KEY, headers: {…} }`.
V Base URL live-checked: `GET https://api.tokenfactory.nebius.com/v1/models` →
`{"detail":"Couldn't authenticate. Reason: token is not present"}`. Header is
`Authorization: Bearer $NEBIUS_API_KEY`. (https://docs.tokenfactory.nebius.com/quickstart)

## 3. Nebius models, price, limits

V 17 router models with $/1M in/out (https://mastra.ai/models/providers/nebius). Picks:

| Job | Model | In/Out $/1M | Ctx |
|---|---|---|---|
| (a) fast JSON moderation | `nebius/Qwen/Qwen3-30B-A3B-Instruct-2507` | 0.10 / 0.30 | 262K |
| cheapest alternative | `nebius/nvidia/Nemotron-3_5-Lightning` | 0.06 / 0.24 | 1.0M |
| (b) creative rewriting | `nebius/zai-org/GLM-5.3-Flash` | 0.15 / 0.50 | 1.0M |
| (b) if it reads flat | `nebius/MiniMaxAI/MiniMax-M3` | 0.30 / 1.00 | 1.0M |

- **U Llama Guard is not on the router list and no Nebius doc confirms it is hosted.** Don't promise
  a guard model to Galtea. Moderate with Qwen3-30B + a JSON schema; to chase Llama Guard, check
  `GET /v1/models?verbose=true` with the real key first.
- V JSON in Mastra is `structuredOutput`, not Nebius's raw `guided_json`:
  `await agent.generate('…', { structuredOutput: { schema: z.object({ safe: z.boolean() }) } })`,
  read off `res.object`. (https://mastra.ai/docs/agents/structured-output)
- V Rate limits are dynamic: ≥80% average use over a 15-min window raises the next window ×1.2;
  ≤50% lowers it ÷1.5; ceiling 20× base. Over-limit → 429 + `Retry-After`; watch
  `x-ratelimit-remaining-requests` / `-tokens`, `x-ratelimit-over-limit: yes`. Defaults are
  account-specific. (https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits)

## 4. Telegram channel

V Adapter is Chat SDK's `@chat-adapter/telegram`, attached to the agent
(https://mastra.ai/integrations/channels/telegram, https://mastra.ai/docs/channels):

```typescript
import { createTelegramAdapter } from '@chat-adapter/telegram'
export const showrunner = new Agent({
  id: 'showrunner', model: 'nebius/zai-org/GLM-5.3-Flash',
  channels: { adapters: { telegram: createTelegramAdapter({ mode: 'polling' }) } },
})
```

- V Env, auto-detected: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET_TOKEN`,
  `TELEGRAM_BOT_USERNAME`, `TELEGRAM_ALLOWED_USER_IDS`, `TELEGRAM_ALLOW_UNVERIFIED_WEBHOOKS`,
  `TELEGRAM_MENTION_ON_REPLY`, `TELEGRAM_API_BASE_URL`. BotFather: `/newbot` → copy token.
- **V NO PUBLIC WEBHOOK NEEDED.** `mode` is `"auto" | "webhook" | "polling"`; polling needs no
  `secretToken`. Long-polling knobs: `timeout`, `limit`, `allowedUpdates`, `deleteWebhook`,
  `dropPendingUpdates`, `retryDelayMs`. (https://chat-sdk.dev/adapters/official/telegram)
  `allowedUserIds` / `TELEGRAM_ALLOWED_USER_IDS` is the cheap demo-day abuse guard.
- V Default inbound path is `/api/agents/<AGENT_ID>/channels/<PLATFORM>/webhook`; polling pulls
  instead. Overridable handlers `onDirectMessage` / `onMention` / `onAction`, each
  `async (thread, message, defaultHandler, ctx) => …`; call `defaultHandler` for stock behaviour. A
  custom handler that throws is only logged — catch and `await thread.post('…')` yourself.
  (https://mastra.ai/reference/agents/channels)
- **V User identity**: default `resourceId` is `` `${platform}:${message.author.userId}` `` →
  `telegram:123456789`. Override via `resolveResourceId` / `resolveThreadId` (they run only on thread
  creation; reused threads keep their stored owner). That is the karma key.

**Proactive "you're on air" DM.** V `thread.post(...)` sends. V A channel can be addressed by id
later — `chat.channel("slack:C123ABC")` — and V a thread survives a round trip via `thread.toJSON()`
+ `JSON.parse(payload, bot.reviver())` then `data.thread.post("…")`
(https://chat-sdk.dev/docs/api/channel, https://chat-sdk.dev/docs/api/thread). V The live Chat SDK
instance is `agent.channels.sdk` (https://mastra.ai/docs/channels).
**U** the join `agent.channels.sdk.channel('telegram:<chatId>').post('…')` appears in no doc.
Timebox the spike to 10 min. **Fallback that cannot fail:** store the chat id on first message, then
`fetch('https://api.telegram.org/bot'+TOKEN+'/sendMessage', …)`. Three lines; the demo requirement is
a DM arriving, not which library sent it.
U Mastra's own primitive is `agent.sendMessage()` / `sendSignal()` into `{resourceId, threadId}`
(HTTP `POST /api/agents/:agentId/send-message`) — wakes an idle thread, but no doc says a woken run
posts back out to Telegram. (https://mastra.ai/docs/harness/signals)

## 5. Memory

V Minimal (https://mastra.ai/docs/memory/message-history):
`new Agent({ id: 'showrunner', memory: new Memory({ options: { lastMessages: 10 } }) })` from
`@mastra/memory`. V Storage: LibSQL local file — `@mastra/libsql`, `url: 'file:./mastra.db'`; the
only backend with a worked example. V Thread = one conversation, resource = its owner (a user); both
passed to `.generate()`/`.stream()`. With the default Telegram `resourceId`, per-user facts key off
`telegram:<userId>` for free. **V Channels require storage on the `Mastra` instance**
(`new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' })`) or subscriptions, dedup and
approvals reset on every restart.

## 6. Custom routes + static index.html — both supported

V `registerApiRoute()` from `@mastra/core/server`; handler gets a Hono `Context`; Mastra instance is
`c.get('mastra')`; routes mount at the server root; `requiresAuth: false` opts out.
(https://mastra.ai/docs/server/custom-api-routes)

```typescript
import { registerApiRoute } from '@mastra/core/server'
export const mastra = new Mastra({
  server: { apiRoutes: [
    registerApiRoute('/say',    { method: 'POST', handler: async c => c.json({ ok: true }) }),
    registerApiRoute('/like',   { method: 'POST', handler: async c => c.json({ ok: true }) }),
    registerApiRoute('/status', { method: 'GET',  handler: async c => c.json(state) }),
  ]},
})
```

**V `index.html` goes in `src/mastra/public/`**: "If a `public` folder exists in your Mastra directory
(`src/mastra/public`), its contents are copied to the output directory during build. These files are
served as static assets by the server." (https://mastra.ai/docs/deployment/mastra-server) U the exact
mount path — one `curl` confirms it; escape hatch is
`registerApiRoute('/', { method: 'GET', handler: async c => c.html(html) })`, file read at boot.

## 7. Harness bits (probably skip)

**requireApproval** — V a boolean on `createTool()`: "When true, the tool requires explicit approval
before execution. The agent will emit a tool-call-approval chunk and pause until approved or
declined." (https://mastra.ai/reference/tools/create-tool) V In channels it renders as an interactive
card and the click returns via the webhook; `toolDisplay: 'hidden'` hides the buttons but "doesn't
turn a message into consent". **U approval cards under polling mode is untested** — that demo is the
one thing that might force a webhook.

**Background tasks / schedules** — V `backgroundTasks: { enabled: true, globalConcurrency: 10,
perAgentConcurrency: 5 }` on the `Mastra` instance + `background: { enabled: true }` on a tool runs a
long tool call without blocking the agent loop (https://mastra.ai/docs/harness/background-tasks).
V Schedules: `await mastra.schedules.create({ agentId, cron: '0 * * * *', prompt: '…' })`; 5/6/7-part
cron or `@hourly`, IANA timezone, persists across restarts; pass `threadId` + `resourceId` to land
the fire in a user's thread (https://mastra.ai/docs/harness/schedules). Both need storage.
**Neither is needed here** — the 12 s steering loop is a `setInterval`.

## 9. Gotchas

1. **No custom OpenAI-compatible provider.** `nebius/<model>` + `NEBIUS_API_KEY` is the whole
   integration (V). Half an hour saved.
2. **`--empty`, not the default scaffold** — the starter's harness/workspace/web tooling is dead
   weight and extra failure surface. And **channels require storage** (V): no `LibSQLStore`, state
   resets on every restart.
3. **Set `mode: 'polling'` explicitly.** The default is `"auto"`; drift into webhook mode and you
   need a secret token and a public URL (V). V A webhook `200` means "received", not "answered", so
   on a serverless host you'd also need `waitUntil` or runs get killed mid-flight.
4. The Tools/Reasoning columns in the Nebius table are blank for every model — missing models.dev
   metadata, not a claim that tool calling is unsupported (U). Test one tool call early.
5. **The model ids are not the ones you remember**: `nebius/MiniMaxAI/MiniMax-M3`,
   `nebius/zai-org/GLM-5.3-Flash`. Copy, don't type from memory.
6. Default port is 4111 (V); `index.html` and the broadcaster tab must use the host's injected
   `PORT`, not a hardcoded 4111.
