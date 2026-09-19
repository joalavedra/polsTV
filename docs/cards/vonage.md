# Vonage Video API — verified 2026-09-19
Every claim is VERIFIED (source) or UNVERIFIED. Nothing recalled from memory.

## 1. Packages (VERIFIED — `npm view`, 2026-09-19)
| package | latest | role |
|---|---|---|
| `@vonage/server-sdk` | **3.30.1** | server: sessions + tokens |
| `@vonage/auth` / `@vonage/video` | **1.18.1** / **1.31.1** | credentials object / video sub-SDK (`MediaMode`) |
| `@vonage/client-sdk-video` | **2.35.2** | browser `OT` (= `@opentok/client` 2.35.2) |
| `opentok` | 2.23.2 | **LEGACY** API-key/secret era — do not use |

Browser can skip npm: `<script src="https://video.standard.vonage.com/v2/js/opentok.min.js">` (VERIFIED
https://developer.vonage.com/en/video/client-sdks/web/overview). `static.opentok.com/…/opentok.min.js` still
returns 200 (VERIFIED curl) but is the old host.

## 2. Server (Node 22)
Auth = **application ID + private key** (JWT), not API key/secret (VERIFIED
https://developer.vonage.com/en/video/server-sdks/node). Self-serve, no mentor needed (VERIFIED
https://developer.vonage.com/en/video/getting-started): dashboard → Applications → Create a new application →
name → **Generate public and private key** (downloads it) → Capabilities → toggle **Video** → Generate new
application; App ID is on the app page. Verbatim from the Node SDK page (CJS as published):
```javascript
const { Auth } = require('@vonage/auth');
const { Vonage } = require('@vonage/server-sdk');
const { MediaMode } = require('@vonage/video');

const credentials = new Auth({ applicationId: 'APP_ID', privateKey: 'PRIVATE_KEY_PATH' });
const vonage = new Vonage(credentials);
const session = await vonage.video.createSession();
const options = { role: "moderator", expireTime: Math.floor(Date.now()/1000) + 24*60*60,
                  data: "name=Johnny", initialLayoutClassList: ["focus"] };
const token = vonage.video.generateClientToken(sessionId, options);
```

Roles (VERIFIED https://developer.vonage.com/en/video/guides/create-token): `subscriber` = connect +
subscribe, **cannot publish**; `publisher` = both; `publisheronly` = publish, no subscribe; `moderator` =
publisher + force-disconnect. Token TTL default **24 h**, max **24 h**. Session must be **routed** or you
lose HLS, archiving, live captions and scalable video (VERIFIED, all four guides). UNVERIFIED: exact
`createSession` options shape in 1.31.1 — read the shipped `.d.ts`.
### Snippet A — token route (viewers get `subscriber` tokens → cannot publish even from devtools)
```js
const { sessionId } = await vonage.video.createSession({ mediaMode: MediaMode.ROUTED }); // once at boot
app.get('/vonage/token', (req, res) => {
  const role = req.query.broadcaster === process.env.BROADCASTER_SECRET ? 'publisher' : 'subscriber';
  res.json({ applicationId: process.env.VONAGE_APP_ID, sessionId,
             token: vonage.video.generateClientToken(sessionId, { role }) });
});
```

## 3. Broadcaster — custom source, no camera prompt
`videoSource` accepts "The ID of the video input device … or a MediaStreamTrack object"; `audioSource`
likewise and "Set to `null` or `false` to disable audio" — **no audio track required**; passing a track means
the browser never calls `getUserMedia`, so **no permission prompt** (VERIFIED
https://vonage.github.io/conversation-docs/video-js-reference/latest/OT.html — still eyeball it in the
spike). Custom sources need opentok.js **≥2.13**; Chrome 51+, FF 49+, Safari 11+ (Publish-Canvas README).
### Snippet B — broadcaster (core lines verbatim from Vonage's Publish-Canvas sample)
```js
const { applicationId, sessionId, token } = await (await fetch('/vonage/token?broadcaster=' + SECRET)).json();
const session = OT.initSession(applicationId, sessionId);
const publisherOptions = {
  insertMode: 'append', width: '100%', height: '100%',
  videoSource: canvas.captureStream(3).getVideoTracks()[0]   // ← verbatim from the sample
};
const publisher = OT.initPublisher('publisher', publisherOptions, handleError);
session.connect(token, (error) => { if (!error) session.publish(publisher, handleError); });
```
source: https://github.com/Vonage-Community/video-api-web-samples/tree/main/Publish-Canvas (`js/app.js`)

Director's WebRTC tracks go in the same field (`videoSource: remoteTrack, audioSource: remoteAudioTrack`) —
UNVERIFIED end-to-end, no sample covers a remote peer track.
Settings for 720p generated video (VERIFIED, OT reference): `resolution: "1280x720"` (only
`1920x1080|1280x720|640x480|320x240` legal), `frameRate: 15` or `30` (only `30|15|7|1`), `videoContentHint:
"motion"` (over `detail`/`text`), `audioSource: null` if SLNG audio stays in its own `<audio>` per PLAN §5
(else `audioBitrate` 6,000–510,000, default 40,000; `enableStereo` false), and `scalableVideo` already
defaults **true** in routed sessions (simulcast to mixed-bandwidth phones) — leave it. UNVERIFIED whether
`resolution`/`frameRate` bind a *custom* track or only camera capture: size the canvas to 1280x720 instead.
**No `videoBitrate` option exists** on `initPublisher` in the docs read and `maxResolution` is screen-share
only — don't invent a bitrate knob. Sample's own warning: a backgrounded tab throttles `setInterval` and
framerate collapses, so keep the tab foregrounded or draw off `requestVideoFrameCallback`.

## 4. Viewer — subscribe only
### Snippet C — viewer
```js
const { applicationId, sessionId, token } = await (await fetch('/vonage/token')).json();
const session = OT.initSession(applicationId, sessionId);
session.on('streamCreated', (event) => {                       // broadcaster came up
  const sub = session.subscribe(event.stream, 'stage',
    { insertMode: 'replace', width: '100%', height: '100%', fitMode: 'cover', subscribeToAudio: true,
      style: { audioBlockedDisplayMode: 'off', buttonDisplayMode: 'off', nameDisplayMode: 'off' } },
    handleError);
  sub.on('audioBlocked',   () => unmuteBtn.hidden = false);    // autoplay policy hit
  sub.on('audioUnblocked', () => unmuteBtn.hidden = true);
  sub.on('disconnected',   () => livePill.classList.add('stalled'));
  sub.on('connected',      () => livePill.classList.remove('stalled'));
});
session.on('streamDestroyed', () => showRerunCard());          // broadcaster dropped
session.connect(token, handleError);
unmuteBtn.onclick = () => OT.unblockAudio();                   // must be inside a real click
```

VERIFIED (https://tokbox.com/developer/sdks/js/reference/Subscriber.html): `Session.subscribe(stream,
targetElement, properties, completionHandler) → {Subscriber}`; `fitMode: "cover"` "crops video if dimensions
don't match" (already the camera default) = your full-bleed; `style.audioBlockedDisplayMode` is `"auto"`
(default) | `"off"`; events `disconnected` ("stream has been interrupted"), `connected` (resumed),
`destroyed`, `videoDisabled`/`videoEnabled` (`codecNotSupported | publishVideo | quality | subscribeToVideo`),
`audioBlocked`, `audioUnblocked`.

**Autoplay** (VERIFIED same page + subscribe guide): Safari, Firefox 66+, Chrome 71+ block audio until a
gesture; it unblocks on a click of the default icon, on `OT.unblockAudio()` *called from a click handler*, or
when the page gains camera/mic access. Ship muted + a "tap for sound" button — fits the tap-to-like UI.
Rendering your own `<video>` from `stream.mediaStream` means adding `autoplay`, `playsinline` and `muted`
yourself; easier to let OT insert the element and style its container. `connectionEventsSuppressed: true` on
`OT.initSession()` stops every viewer waking on every other viewer's connect/disconnect (VERIFIED
https://developer.vonage.com/en/video/guides/broadcast/interactive; UNVERIFIED spelling against 2.35.2).

## 5. Limits + fan-out (VERIFIED interactive + live-streaming guides)
Routed session where everyone subscribes: **15,000** connections and 15,000 streams, sub-second WebRTC. HLS
broadcast: **unlimited** viewers, **15–20 s** behind live (low-latency mode = `low-latency: true`, excludes
DVR, UNVERIFIED latency — docs give no number). RTMP out: ~**5 s** from Vonage plus the provider's own.
HLS/RTMP are routed-only, compose ≤16 video + ≤50 audio streams, DVR = 2 h rewind (gone 2 h after stop),
maxDuration 4 h default (14,400 s), settable 60 s–10 h. **Take the plain routed session** — 15,000 beats any
demo room, and HLS's lag would desync the chat rail from the picture.

## 6. Archiving + captions
Archiving (VERIFIED https://developer.vonage.com/en/video/guides/archiving/overview): **no account toggle**,
start from a Server SDK call; routed + ≥1 connected client. Composed = one **MP4** (H.264/AAC), ≤16 video
streams, immediately playable. Auto-archive "starts as soon as a client connects", stops 60 s after the last
leaves; max 4 h; files live **72 h** on Vonage cloud unless you configure S3/Azure; download URL only via
REST/SDK with credentials. Covers PLAN §3's rerun loop — archive the live stint, re-publish the MP4 from the
broadcaster tab (`Publish-Video` sample) when the queue empties. UNVERIFIED: archive method name in 1.31.1.

Live Captions (VERIFIED https://developer.vonage.com/en/video/guides/live-caption): "**enabled by default
for all applications**, and it is a usage-based product" — no feature request, routed only. Publisher opts in
with `publishCaptions: true` (or `setPublishCaptions(true)`), viewer calls `subscribeToCaptions(true)` and
handles `captionReceived` (`text`, `isFinal`). 50+ languages via `languageCode`, auto-stops at 4 h, billed
per transcribed audio stream; sample `Basic-Captions`. **Catch:** it transcribes *session* audio — a SLNG
announcer playing in a separate `<audio>` (PLAN §5) is invisible to it, so scoring this means publishing the
announcer as the publisher's `audioSource`.

## 7. Pricing / free credit (VERIFIED api.support.vonage.com)
New accounts (unified environment) get **75,000 free participant test minutes + 25,000 minutes of advanced
video features**; then $0.0041 / €0.00373 per participant-minute up to 15,000 participants and 25 active
publishers (the $10-credit trial in older docs is superseded). ~10 viewers × 24 h ≈ 14,400
participant-minutes = free — Vonage is not the cost risk here; fal Director at $72/h is (PLAN §0).

## 8. Gotchas (all VERIFIED from https://developer.vonage.com/en/video/client-sdks/web/overview)
- **HTTPS required**: "Safari does not support camera access (or stream publishing) in pages loaded using the
  http: … or file: … URI schemes" — a `file://` broadcaster page will not publish.
- **Safari + localhost is broken**: "Safari does not support camera access on localhost". Develop in Chrome;
  open Safari only against the deployed HTTPS URL.
- **Codec**: older Safari is H.264-only, no VP8. A subscriber that can't decode fires `videoDisabled` reason
  `"codecNotSupported"` — log it, fastest signal of a wrong project codec.
- Floor: Chrome/Firefox latest, Edge 79+, Safari 11+, WebView Android 36+. Clear the draw interval on the
  publisher's `destroyed` event (verbatim in the sample).

## 9. Resolve in the spike
(1) `createSession`/archive option shapes in `@vonage/video` 1.31.1 — read the `.d.ts`. (2) Publishing a
remote `RTCPeerConnection` track as `videoSource`: plausible, untested, no sample. (3) Spelling of
`connectionEventsSuppressed` in 2.35.2. (4) Low-latency HLS latency. (5) Do `resolution`/`frameRate` bind a
custom track at all?
