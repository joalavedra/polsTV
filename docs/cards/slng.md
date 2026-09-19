# SLNG — verified 2026-09-19

Plain REST, two endpoints. No SDK. Skip the agent runtime and skip unmute. VERIFIED = checked against
docs.slng.ai or a live API call today; everything else is marked UNVERIFIED.

## 1. Docs, keys, credit

- VERIFIED Docs: <https://docs.slng.ai> (Mintlify — append `.md` to any path for clean markdown; full
  index at <https://docs.slng.ai/llms.txt>). `docs.slng.ai/hackathon` still 404s and no hackathon page
  exists; the quickstart is <https://docs.slng.ai/guides/get-started/quickstart>.
- VERIFIED Key: <https://app.slng.ai> → Projects → New project → Generate key. "Copy the key before
  closing the dialog: you can only see it once." Prefixes `slng_cu_` (consumer), `slng_bt_` (batch).
- UNVERIFIED **Free credit is documented nowhere** — no pricing page, no trial, no plan tiers. → Q1.

## 2. TTS

- VERIFIED (<https://docs.slng.ai/guides/models/your-first-request> + each model page's OpenAPI)
  `POST https://{region}.api.slng.ai/v1/tts/{model-id}`; model ID incl. `slng/` prefix is in the path.
  `Authorization: Bearer $SLNG_API_KEY`, body JSON. **Response is raw binary audio** (`audio/*`), not JSON.
- From Barcelona use **`slng/fish/tts:s2.1-pro` on `eu-west.api.slng.ai`** — its page: "Available in
  Netherlands, Germany, Australia, United Kingdom." VERIFIED **avoid `slng/deepgram/aura:2-en`**:
  "Available in United States (East, West)", a transatlantic hop per line. (The auth page calls Aura on
  an EU host anyway — that example is wrong, see Gotchas.)
- Fish body: `text` (required), `reference_id` (voice), `format` `wav|pcm|mp3|opus` default `mp3`,
  `mp3_bitrate` `64|128|192` default 128, `sample_rate`, `prosody.speed` 0.5–2.0, `temperature` 0.7.
  Aura body (US only): `model` required (`aura-2-thalia-en`, 41 English voices), `text`, `encoding`
  default `mp3`, `sample_rate` default 24000, `container` default `wav`.
- Latency, VERIFIED as a docs *claim* not a measurement
  (<https://docs.slng.ai/guides/models/websockets-vs-http>): HTTP "Whole response in about 200 to 500 ms";
  WebSocket "First audio in under about 100 ms". WS exists at the same path with `wss://`, but **use
  HTTP** — the line is fully known before synthesis and the browser needs a file for `<audio>`.

```js
// Node 22, no deps. Write the Buffer to /public/announcer/<id>.mp3, put the URL in /status.
const t0 = performance.now();
const res = await fetch("https://eu-west.api.slng.ai/v1/tts/slng/fish/tts:s2.1-pro", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SLNG_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ text: line, reference_id: VOICE_ID, format: "mp3" }) });
if (!res.ok) throw new Error(`SLNG TTS ${res.status}: ${await res.text()}`);
const mp3 = Buffer.from(await res.arrayBuffer());
console.log("tts_ms", Math.round(performance.now() - t0), "bytes", mp3.length);
```

UNVERIFIED `reference_id`: the docs' `16cabdb7f8d240569aff36c9e480d783` is illustrative. Get real IDs from
`GET /v1/catalog/models?service_type=tts` or <https://docs.slng.ai/models/voices/fish-audio>. → Q2.

## 3. STT — MediaRecorder → our server → SLNG

- VERIFIED (<https://docs.slng.ai/api-reference/speech-to-text/slng/deepgram-nova-3/nova-3-english-http>)
  `POST https://{region}.api.slng.ai/v1/stt/slng/deepgram/nova:3-en`, `multipart/form-data` with an
  `audio` part; or JSON with `url` or base64 `audio`. One-shot HTTP is right for hold-to-talk; streaming
  STT buys nothing for a 3-second clip.
- **`encoding` enum includes `webm` and `opus`** (full: `linear16, flac, mulaw, amr-nb, amr-wb, opus,
  speex, mp3, mp4, webm, aac, ogg`). A browser MediaRecorder blob posts as-is — no transcode.
- Flags: `punctuate` (default **false** — enable it), `smart_format`, `detect_language` (default false),
  `filler_words`, `profanity_filter`, `keywords[]`. Response:
  `results.channels[0].alternatives[0].transcript` (+ `confidence`, `metadata.request_id`); detected
  language at `results.channels[].detected_language`.

```js
// browser: new MediaRecorder(stream, { mimeType: "audio/webm" }); on stop, POST the Blob to /say-voice
// server: forward that same blob to SLNG, untouched
const up = new FormData();
up.append("audio", new Blob([buf], { type: "audio/webm" }), "say.webm");
const r = await fetch("https://eu-west.api.slng.ai/v1/stt/slng/deepgram/nova:3-en?punctuate=true", {
  method: "POST", headers: { Authorization: `Bearer ${process.env.SLNG_API_KEY}` }, body: up });
const text = (await r.json()).results.channels[0].alternatives[0].transcript;
```

UNVERIFIED: whether options go as form fields or query params on the multipart path — OpenAPI says body,
the only curl example sends just `audio=@file` (→ Q3); and nova:3-en's regional availability, since its
page omits the hosting line the TTS pages carry. If eu-west 404s, fall back to `deepgram/nova:3`.

## 4. Voice-agent runtime — skip it

VERIFIED it exists: a managed-agent control plane at `api.agents.slng.ai` (agents, tools, MCP, telephony,
browser sessions via LiveKit). **Wrong shape — do not touch it.** It models a turn-taking conversation with
barge-in and endpointing; we have a one-way announcer and a push-to-talk capture, no dialogue, no per-viewer
session, and two REST calls deliver the whole feature. Tell the judges: "at the core" holds because the
channel has no voice without SLNG, not because we used the biggest product.

## 5. "unmute framework" — SLNG's own, and not for us

- VERIFIED SLNG's own: <https://github.com/slng-ai/unmute>, Go, MIT, **v0.5.5 released 2026-09-18**, 16
  stars. Docs <https://unmute.ai>: "A declarative standard for voice agents. Describe the agent once,
  compile it to Pipecat, LiveKit, or SLNG." "Building on it" = write `agent.yaml` + `targets.yaml`, run
  `unmute validate/compile/deploy` (templates: <https://github.com/slng-ai/unmute-templates>). VERIFIED
  it is **not** Kyutai's `kyutai-labs/unmute`, a runtime speech wrapper — same name, different company,
  so do not cite the wrong one in the submission.
- Fit: **2–4 h, and it only pays off for a conversational agent, which we are not building.** Unmute
  compiles agents; it says nothing about a one-shot TTS call. The extra points would cost us an invented
  conversational feature. Stretch-only: a `channel-announcer` package as an artefact, not in the live path.

## 6. SDK / npm

- VERIFIED `voiceai-sdk` **0.2.0, published 2026-05-13**, CommonJS. A `1.0.0` exists (2025-08-05) but
  `latest` points at 0.2.0 — the version line is not linear. Four months stale.
- VERIFIED `voiceai-cli` **0.1.19, published 2026-09-09** — maintained; good for a smoke test
  (`voiceai login && voiceai tts "..." -m slng/fish/tts:s2.1-pro --out a.mp3`). Also `n8n-nodes-slng`
  0.4.1; repos `slng-ai/examples` (Next.js TTS/STT + Nova WS HTML demo) and `slng-ai/skills`.
- **Use plain `fetch`** — a stale CJS SDK in ESM Node 22 is a dependency and an interop problem for zero
  lines saved.

## 7. Numbers for the submission

Cost — VERIFIED live from the public catalog (`GET https://api.slng.ai/v1/catalog/models?service_type=tts`,
auth optional), unit as returned, `microdollars_per_min`: `slng/fish/tts:s2.1-pro` **110** ·
`slng/deepgram/aura:2-en` **100** · `slng/deepgram/nova:3-en` **41** · `soniox/speech-ai:rt-v5` **28**.
At 110 µ$/min, a 4 s line every 12 s over an 8 h stream ≈ 160 audio-minutes ≈ **$0.018**. Small enough to
double-check: the field is `min_price` (cheapest region) and the unit is unusual. → Q4.

Measure, don't quote the docs: wrap both calls in `performance.now()`, log `{chars, bytes, ms}` to JSONL,
report p50/p95 over the whole demo run. For "audio quality before and after", record the same line through
two voices (Fish vs proxied Aura) and ship both clips — literally what they asked for. Cross-check spend
at **Billing & Usage → Direct API → Model breakdown**; export and screenshot it.

## 8. Gotchas

1. **The docs' copy-paste hosts are broken.** Auth, first-request and websockets pages use
   `https://eu-west.slng.ai/...` — VERIFIED that host **does not resolve** (DNS failure). Working shape is
   `{region}.api.slng.ai`, stated in the same pages' prose and every OpenAPI `servers` block; VERIFIED live,
   `eu-west.api.slng.ai` / `us-east.api.slng.ai` / `api.slng.ai` all return `401 {"error":"Unauthorized"}`.
2. Regional hosting differs per model (Aura EN = US only, Fish = EU/AU/GB); the wrong pick silently costs
   ~150 ms per line from Barcelona.
3. TTS returns binary — `res.json()` throws. Use `arrayBuffer()`.
4. Voice field is model-specific: Fish `reference_id`, Gradium `voice_id`, Aura `model`. No portable one.
5. Aura defaults are `encoding: mp3` **and** `container: wav` — set both explicitly. Key is shown once:
   into `.env` immediately. `api.agents.slng.ai` returns 403 (not 401) unauthenticated — different plane,
   not an auth-header bug.

## Mentor questions (Ismael Ordaz, Tolga Yapici, Francisco Javier)

- **Q1** Is there hackathon credit on our account, and what is the cap? Docs mention no free tier at all.
- **Q2** Which `reference_id` gives a TV-announcer voice on `slng/fish/tts:s2.1-pro`?
- **Q3** On multipart STT, do `punctuate`/`encoding`/`detect_language` go as form fields or query params?
- **Q4** Is `pricing.min_price` in `microdollars_per_min` literal, and is it what we are billed in eu-west?
- **Q5** Is `eu-west.slng.ai` in the docs examples a typo for `eu-west.api.slng.ai`? It does not resolve.
- **Q6** For "SLNG at the core", does one-way TTS + hold-to-talk STT count, or do they expect a managed
  agent? We think the former — confirm before Sunday.
