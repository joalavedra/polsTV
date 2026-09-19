# HackBarna AI Summit 26 — factual scan

Primary source: https://www.hackbcn.com/en/events/aisummit26 (JS-rendered Next.js; I pulled the raw DOM + the embedded i18n bundle, so quotes below are verbatim from the page). Secondary: https://luma.com/3gswve8n, https://www.deepfire.co/hackbarna (rendered headless), plus provider docs.

**Note: the event starts today, Sat 19 Sep 2026.** Luma currently shows **"Event Full"** with a waitlist.

---

## 1. Event basics

| Item | Value | Source |
|---|---|---|
| Name | HackBarna AI Summit 26 (Luma title: "AISB Hackathon 2026"), 3rd edition | site, Luma |
| Dates | Sat 19 Sep – Sun 20 Sep 2026 | site |
| Hours | Sat 09:00–23:00 ("Doors close for the night" 23:00), Sun 09:00–18:00 | site, Luma |
| Venue | Norrsken House Barcelona — **Passeig del Mare Nostrum, 15, Ciutat Vella, 08039 Barcelona** | Luma |
| Format | In-person only, ~150 hackers. **"Overnight stays are not allowed at the venue."** "We will give priority to participants that can attend in-person." | Luma, site FAQ |
| Co-organizer | AI Summit Barcelona 2026 (the summit itself is 22–23 Sep at WTC Barcelona, separate event) | site |
| Team size | **"We recommend team of 3 maximum to enjoy a full experience. If you want to bring more friends, split the team or meet new team members at the event."** Luma states "Maximum three members per team" and that everyone applies individually even if pre-formed. | site FAQ, Luma |
| Code submission deadline | **Sunday 11:00 AM** | site schedule |
| Demos | Sunday 14:00 "Project Demos & Presentations" (pitch length **not stated**) | site |
| Judging | Sunday 16:00 "Judging & Deliberation"; Awards 17:30 | site |
| Hosts | Lucas Sala, Nicolas Grenié, Mariana Noriega, HackBarna | Luma |

**Schedule (verbatim):** Sat — 09:00 Registration & Breakfast · 10:00 Opening Keynote · 11:30 Hackathon Launch & Team Formation · 13:00 Lunch & Networking · 14:00 Workshops & Technical Sessions · 18:00 Dinner · 20:00 Hacking continues · 23:00 Doors close for the night. Sun — 09:00 Breakfast & Final Push · 11:00 Code Submission Deadline · 13:00 Lunch · 14:00 Project Demos & Presentations · 16:00 Judging & Deliberation · 17:30 Awards Ceremony · 18:00 Closing & Networking.

### Submission format — PARTIALLY UNVERIFIED
There is **no global submission platform named anywhere** (no Devpost, no Notion, no form link on the site or Luma; I searched and found none). Only per-challenge submission artifacts are specified:
- **Mastra** (most explicit): *"Submit by the Sunday 11:00 code freeze — bot handle or invite link, repo URL, a 60-second recording of a real conversation, and one line on who it's for."*
- **fal**: *"A public GitHub repo with a README... A short demo video showing the stream running."*
- **QualityClouds**: *"A two-minute 'defend your code' talk"* to the judges.
- The [project archive](https://www.hackbcn.com/en/projects) shows past entries as name + one-line description + tech-stack tags, implying a simple form.

Assume the submission link is announced at the 11:30 launch. **Do not treat this as confirmed.**

---

## 2. Sponsors / partners — COMPLETE LIST

Pulled from the sponsor block's logo `alt` attributes and the embedded JSON (`{"name":"Make","logo":"/logos/make.png","url":"https://www.make.com/","tier":"silver"}` etc.), so this is the full list, not a visual guess.

| Tier | Name | Has own challenge? |
|---|---|---|
| Co-organizer | AI Summit Barcelona 2026 | No (provides conference tickets + pitch slot) |
| Venue | Norrsken House Barcelona | **Yes** — wildfire challenge (with Deepfire) |
| **Gold** | **Vonage** | **Yes** |
| Silver | Preply | Yes |
| Silver | Mastra | Yes |
| Silver | Nebius | Yes |
| Silver | Cognition | Yes |
| Silver | Fal.ai | Yes |
| Silver | QualityClouds | Yes |
| Silver | Galtea | Yes |
| Silver | **Make** | **NO challenge listed** — logo + a mentor (Sonia Toqqe, Event Marketing Manager) only |
| Silver | SLNG | Yes |
| Silver | Titan OS | Yes |
| Community | Le Wagon Barcelona | No |
| Community | FemCoders Club | No |

**Prize contributors that are not listed as sponsors:** `fleet.co` (MacBook + AirPods), `Bynd.vc` (mentorship). **Deepfire** hosts the wildfire challenge data but isn't in the sponsor list — its founder Louis Cameron Booth is a judge.

**11 sponsor challenges total.** Vonage is the only Gold. Make is the only sponsor with a logo but no challenge — if you want max coverage, using Make costs you nothing but wins you nothing either.

---

## 3. Per-challenge requirements and prizes (verbatim where load-bearing)

### 1. Titan OS — "AI agent for content recommendation on TVs"
**Prize: A Philips Ambilight 43" TV for each team member.**
Requirements: *"A working prototype of a conversational agent that recommends movies, shows, or live TV."* · *"The user interacts through dialogue: natural language requests and follow-up questions."* · *"Designed for the TV: remote or voice input, usable from the couch."* · *"Any public catalog or metadata source is fine (e.g. TMDB)."*
Strong submission: end-to-end demo (mock data OK), *"a real conversation... not just one prompt, one answer"*, *"A UX that works on a TV screen, not a mobile chat app."*
Sponsor link: https://www.titanos.tv/

### 2. Nebius — "Build, adapt and ship with Nebius Token Factory"
**Prize: $1,000 (1st) · $500 (2nd) · $100 (3rd).**
Requirements: *"Token Factory must be used meaningfully in the working project."* · *"Its use should contribute directly to the product's core functionality or demonstrate a measurable improvement in quality, grounding, evaluation, speed, cost or reliability."*
Explicitly stack-friendly: *"Teams may combine Token Factory with any other HackBarna sponsor or developer tool, but no additional integration is mandatory."*
Docs: https://docs.tokenfactory.nebius.com/quickstart · Models API: https://docs.tokenfactory.nebius.com/api-reference/models/list-models · cookbook: https://github.com/nebius/token-factory-cookbook

### 3. Cognition — "Devin for X — Building the Autonomous Layer"
**Prize: A 6-month Devin Max subscription for each team member.**
Requirements: *"Devin sessions are created and driven through the API, not the web UI."* · *"Something in your code decides whether each output passes — a test suite, a simulator, a solver, or a validator. Not a person, and not a model saying it looks good."* · *"Failures go back to Devin and it tries again. Show us a run where the first attempt was wrong and the system fixed it on its own."*
Judging: Autonomy (*"external trigger, little or no human in the loop, and it demonstrably recovers from its own failures"*) · Guardrails (*"verifies independently, and correctly refuses or escalates work that shouldn't ship"*) · The product (*"a real problem and a functional artifact at the end — deployed, executable, or physically actionable. Would someone actually use this?"*) · Orchestration (*"creative use of the API, and complexity that earns its place — fan-out, adversarial checks, learning across runs"*).
Framing quote: *"Devin proposes; your layer authorizes, and sometimes refuses. Build for consumers or enterprise — the more the output is something a user can see, play, hold, or use, the better it demos."*
Docs: https://docs.devin.ai/get-started/devin-intro · API: https://docs.devin.ai/api-reference/overview · usage examples: https://docs.devin.ai/api-reference/v3/usage-examples · advanced: https://docs.devin.ai/work-with-devin/advanced-capabilities

### 4. Vonage (Gold) — "Best use of the Vonage Video API"
**Prize: A Corsair Void v2 Wireless headset for each winning team member (max 3), plus "a t-shirt for every team that uses the Vonage Video API."**
Judging, explicitly weighted: *"Functionality: does it work and meet its intended purpose? ... Creativity: is the idea original, imaginative, and fun? ... Use of Vonage Video API: how effectively and deeply is the API integrated? ... User Experience: is the interface intuitive and well-designed? ... Impact & Potential: does it solve a real problem, and could it grow into something bigger? ... Each area is scored out of 5; the highest overall score wins."* (5 criteria × 5 pts = 25.)
Surface: *"The Vonage Video API supports real-time video, screen sharing, recording, live captions, background effects, AI audio pipelines, and more — across Web, iOS, Android, and React Native."*
Suggested ideas on the page: video bot that verifies identity with AI; video call with live speech translation; telehealth app with live captions and call summaries; virtual classroom with automated meeting notes; immersive AR/VR video experience.
Docs: https://developer.vonage.com/en/video/overview · AI: https://developer.vonage.com/en/video/video-ai · samples: https://github.com/Vonage-Community/video-api-web-samples

### 5. fal — "Build an infinite livestream app using H3 Max Director"
**Prize: $1,000 in fal credits.**
Requirements: *"Use MiniMax H3 Max Director via the fal API as the core of your app. You can combine it with any other fal models or external services."* · *"The video must be generated live by your app, not pre-rendered."* · *"The output must be viewable in a browser or app."*
Strong submission: *"A public GitHub repo with a README explaining what the app does and how it uses H3 Max Director."* · *"A short demo video showing the stream running."* · *"A clear creative concept, and a use of Director that a simple text-to-video call couldn't achieve."*
Framing: *"Director generates video in real time and lets your app steer it as it streams. Build something creative on top of that — we are not suggesting use cases on purpose. Surprise us."*
Model: https://fal.ai/models/minimax/h3-max/director

### 6. SLNG — "Best use of the SLNG platform"
**Prize: A LEGO set for each winning team member.**
Requirements: *"Use SLNG at the core of your project, whether that's the speech-to-text API, the text-to-speech API, or a full voice agent on top."* · *"Show what you built and where SLNG fits in your stack."* · *"Bring any orchestrator, models, or providers you like. SLNG sits underneath."*
Bonus: *"Extra points for building on the unmute framework. Show what you made with it and how."*
Strong submission: *"A voice agent that actually runs, live or recorded."* · *"A clear walkthrough of how SLNG (and unmute, if you used it) makes it work."* · *"Real numbers where you have them, like latency, cost, and audio quality before and after."*
Claimed numbers on the page: *"53% less LLM cost, 39% less turn latency"*, 15 sovereign regions.
⚠️ The linked hackathon guide **https://docs.slng.ai/hackathon returns 404** (I rendered it headless — "Page Not Found"). Ask an SLNG mentor (Ismael Ordaz, Tolga Yapici, Francisco Javier) for the real URL/keys.
Other resource: https://unmute.ai

### 7. Galtea — "Find your AI's worst flaw and prove you can fix it"
**Prize: 3 LEGO sets (Game Boy, Pixar Lamp, Polaroid), 3 Galtea T-shirts, and a free 3-month Galtea Pro subscription for the winning team.**
Mission: *"Find: uncover a failure that could matter to a real user. Fix: change your product to address the cause. Prove: re-run the evaluation and show the before-and-after results."*
Framing: *"Point Galtea at whatever you built — a chatbot, a RAG app, a voice agent, or a tool-using system. Describe what it should do in one line, then let Galtea generate adversarial inputs, test behaviour outside your product's intended scope, and evaluate the results."*
**Hard eligibility gate:** *"To qualify for the prize, complete the product feedback survey. Positive or critical, it will not affect your score."* → https://tally.so/r/J9Pyar
Judging: Impact (*"would a real user encounter this failure, and what would it cost them?"*) · Discovery (*"did your tests uncover a problem you didn't know existed?"*) · Fix (*"did you fix it? Show the failing case, explain the change, and share your rerun's results."*).
Docs: https://docs.galtea.ai/introduction · quickstart: https://docs.galtea.ai/quickstart · SDK: https://docs.galtea.ai/sdk/installation · API ref: https://docs.galtea.ai/api-reference/health-check · Claude Code/Cursor skill: https://docs.galtea.ai/sdk/integrations/agent-skill · platform: https://platform.galtea.ai/?utm_source=ai_summit_hackathon

### 8. QualityClouds — "Production Ready: ship AI code you can defend"
**Prize: A Keychron V6 8K mechanical keyboard (ISO-ES) for each winning team member, plus 12 months of Norma Pro.**
**Requirement (single line): "One scan, at least one fix, and one rescan."**
Setup (pick either or both): *"All through MCP: connect the Norma MCP server to Claude, Cursor, or VS Code, then scan, fix, and rescan without leaving the agent."* / *"Full Scan on repo: connect GitHub, run a Full Scan, fix, and rescan."*
Judging: *"Final Production-Ready Score."* · *"Issues found and fixed during the event (audit-trail delta)."* · *"A two-minute 'defend your code' talk covering one finding you fixed and one you consciously accepted."*
Note: *"Build anything you want — any idea, any stack, any AI tools. Norma is not a constraint on what you build; it is the layer you use to improve your project and defend it in front of the judges. Show the judges a verdict, not a vibe."* — stack-agnostic, cheapest challenge to bolt onto anything.
Product & docs: https://qualityclouds.ai/norma · MCP: https://github.com/qualityclouds/norma-mcp · demo repo: https://github.com/qualityclouds/Norma-byQualityClouds-demo-repo · VS Code extension: https://marketplace.visualstudio.com/items?itemName=qualityclouds.norma-for-vscode

### 9. Mastra — "Build an agent people can message"
**Prize: €250 to the winning team.**
Go beyond a wrapper (do at least one): *"Remember: it knows who it's talking to and what they said yesterday, using Mastra memory."* · *"Act: it calls tools that change something in the world, and asks for approval in the chat before anything risky (requireApproval renders Approve / Deny cards in the channel)."* · *"Run a process: a multi-step workflow that pauses for a human and resumes later."* · *"Message first: a schedule or background task means it reaches out to the user, not just the other way round."*
Rules (verbatim): *"Built on Mastra (@mastra/core), with any model provider through the model router. **Nebius Token Factory counts, so one project can enter this and the Nebius challenge.**"* · *"Reachable on at least one real messaging platform through Mastra Channels."* (Telegram, Discord, Slack, WhatsApp, Teams, iMessage) · *"Does at least one of the four things above."* · *"A public repo with a README that gets a stranger from clone to first message. **This also satisfies the Cognition open-source challenge.**"* · *"Built during the event. Existing ideas are fine, existing code is not."* · *"Submit by the Sunday 11:00 code freeze — bot handle or invite link, repo URL, a 60-second recording of a real conversation, and one line on who it's for."* · *"Keep the bot live until 17:30 Sunday; the remote judge messages it in the afternoon."*
**Judging with explicit point weights:** *"Works from a stranger's phone (30 points): responds in reasonable time, stays coherent, and handles a message it wasn't built for."* · *"More than a wrapper (30 points): remove the memory, tools, workflow, or schedule — does the product collapse?"* · *"Someone would keep it (20 points): a clear user and a clear problem. Would the judge leave the bot in their contacts?"* · *"Craft (20 points): readable agent instructions, tool schemas that make sense, and a README that works."* · *"Tie-break: whichever bot is still answering when the judge checks again at 17:00."*
Framing: *"A remote Mastra judge will message your agent cold, from their own phone, with no walkthrough. Nobody watches a demo; they text it. A chatbot that answers questions is the floor — your agent has to do at least one thing a plain LLM wrapper can't."*
Resources: `npm create mastra@latest` · https://mastra.ai/docs · channels https://mastra.ai/docs/channels · Telegram https://mastra.ai/integrations/channels/telegram · Discord https://mastra.ai/integrations/channels/discord · memory https://mastra.ai/docs/memory · harness (schedules, background tasks, durable agents) https://mastra.ai/docs/harness/overview · templates https://mastra.ai/templates · https://github.com/mastra-ai/mastra

### 10. Preply — "Best use of AI for Learning"
**Prize: "To be announced."**
Brief: *"Build something that helps a user learn — languages, coding, music, anything. Preply is the human-led, AI-enabled language-learning platform connecting learners in 180 countries with 150,000+ tutors across 90+ languages."*
Judging: *"Effectiveness: is there any signal of progress?"* · *"Engagement: would you come back tomorrow?"* · *"User experience: how polished and intuitive the whole flow feels."* · *"Creativity: an original use of AI, not another chat wrapper."*
No API requirement stated — Preply has no public developer API in the challenge. This is a theme challenge, not an integration challenge.

### 11. Norrsken House Barcelona (data by Deepfire) — "AI for Wildfire: detect, track, and predict wildfires from real-time data"
**Prize: "First place: a 3-month Norrsken House membership per team member. Second and third place: 10 Norrsken day passes per team."**
Framing: *"Spain just had a record-breaking wildfire year. We are drowning in data — satellites, cameras, weather stations — but the hard part is pulling accurate, actionable signal out of it in real time. Build something that does exactly that."*
Pick **one of four tracks**: *"Early detection: train a model that accurately detects wildfires from cameras, satellites, or other feeds, so firefighters are alerted as early as possible."* · *"Monitoring active fires: draw real-time perimeters of active fires from satellite data, determine the direction they are spreading, and simulate their movement."* · *"Prediction: identify where and when fire risk is highest by analyzing weather data for high-risk conditions and days."* · *"Values at risk: build an agentic system that identifies the infrastructure, people, and assets in danger when a fire breaks out, and helps make evacuation calls (which hospital, which school, etc.)."*
Strong submission: *"Works on real data from the provided resources."* · *"Produces results in, or near, real time."* · *"Clearly shows how a firefighter or emergency coordinator would actually use it."*
Judging: *"Using AI to actually help first responders do their jobs better."* · *"Technical implementation and accuracy on real data."* · *"Creative use of the provided datasets and APIs."* · *"Demo quality."*
**Datasets provided** (from https://www.deepfire.co/hackbarna):
- Deepfire API — *"Unified API for hotspots, clusters, fire spread"*: https://docs.deepfire.co/api/hotspots
- Satellite data — *"Satellite data from MTG, taking photos of Spain every 10 minutes"*: https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MTG/MTFRPPixel/
- Smoke detection — *"Dataset for smoke detection from cameras"*: https://huggingface.co/datasets/pyronear/pyro-sdis
- Weather model — Google WeatherNext: https://deepmind.google/science/weathernext/
- Fire spread model — ELMFIRE: https://elmfire.io/
- *"Generalitat de Catalunya geographic information (Department of Interior)"*: https://interior.gencat.cat/ca/serveis/informacio-geografica/

---

## 4. Overall prizes (verbatim)

**🥇 First place:** Unique trophy · 3 gold tickets to the AI Summit conference (€655 value each) · *"Pitch at the AI Summit startup competition in front of investors"* (https://startups.aisummitbarcelona.com/) · MacBook and AirPods by fleet.co (https://fleet.co) · Mentorship session with Pedro from Bynd.vc (https://bynd.vc) · $1,000 in Nebius credits · A 6-month Devin Max subscription · *"Thousands of tokens and credits"*

**🥈 Second place:** Unique trophy · 3 silver tickets (€355 value each) · A 4-month Devin Max subscription · Tokens and credits

**🥉 Third place:** Unique trophy · 3 silver tickets (€355 value each) · A 2-month Devin Max subscription · Tokens and credits

**No eligibility criteria are stated for the overall prizes** — no "must use X". The site gives no overall judging rubric either (see gaps).

---

## 5. Rules

From the site FAQ (extracted from the i18n bundle — the accordion doesn't render in raw HTML):
- **New code only:** *"To keep the playing field level and encourage fresh ideas, participants should start a new project during the hackathon. However, feel free to brainstorm and gather your thoughts before the event!"* Mastra restates it harder: *"Built during the event. Existing ideas are fine, existing code is not."*
- **Enforcement:** *"Participants retain full ownership of intellectual property. We might ask for github access just to ensure the work has been done over the weekend and it's not previous project."*
- **IP:** *"Participants retain full ownership of intellectual property."*
- **Open source:** **not required globally.** Public repo is required only by Mastra and fal (and Mastra's line implies Cognition has an open-source requirement — see gaps).
- **What you can build:** *"Anything your heart desires! Whether it's an app, a website, a game, or something uniquely innovative, as long as it relates to our theme and guidelines. Let your creativity run wild and showcase your skills!"*
- **Who can attend:** *"HackBarna is open to everyone - students, professionals, and hobbyists. Whether you're a beginner or an expert, if you're excited about technology and innovation, we want you here!"* No-code / vibe-code / full-code all welcome.
- **No team:** *"No team? No problem! We'll have team formation and networking activities at the start of the hackathon."* (11:30 Sat)
- **Remote:** *"We aim for HackBarna to be the kickoff of a local community of AI practicioners, here in Barcelona. We will give priority to participants that can attend in-person."* Luma: in-person only, no remote participation.
- **Bring:** *"Bring your laptop, charger, any tech accessories you might need, and a positive attitude! We'll take care of food and drinks."*
- **Code of Conduct:** https://www.hackbcn.com/en/conduct — *"TL;DR: Be respectful, harassment and abuse are never tolerated."*

## Tracks/themes
There is **no global track system**. The only themed track structure is inside the Norrsken/Deepfire wildfire challenge (4 tracks, pick one). Everything else is per-sponsor challenges you opt into.

---

## 6. What each provider's API actually does

| Provider | One-liner |
|---|---|
| **Vonage** (Gold) | CPaaS (Ericsson-owned). **Video API** = WebRTC real-time video/audio sessions with screen share, recording, live captions, background effects, AI audio pipelines; Web/iOS/Android/React Native SDKs. |
| **Nebius** | AI cloud. **Token Factory** = hosted **LLM inference**, OpenAI-compatible (`https://api.tokenfactory.nebius.com/v1/`, uses the standard OpenAI client with a custom base URL + `NEBIUS_API_KEY`), plus fine-tuning and model customization. |
| **Cognition** | Makers of **Devin**, the autonomous AI software engineer. The **Devin API** programmatically spawns and drives coding sessions (shell + browser + VM) rather than a chat box. |
| **fal** | Generative-media inference cloud (image/video/audio models). **MiniMax H3 Max Director** = **streaming, live-steerable video generation** — live text prompts, optional first-frame image, an optional script with beats at timestamps, target audio tracks, memory of prior context; keeps character/setting/story continuity; sessions up to 15 min by default; $0.02/s promo, $0.08/s list, 1080p is 2×, $1.20 minimum per session. |
| **SLNG** | **Voice-AI execution layer**: STT (noise cancellation, VAD, language detection, speaker separation) + TTS + optional full voice-agent runtime, routing across 30+ models/providers and 15 sovereign regions. Sits between your orchestrator and your models. ~$0.0033/agent-minute; claims 200–300 ms less latency per turn, <2 ms routing overhead. |
| **Galtea** | **AI evaluation / adversarial testing platform** — generates adversarial inputs, tests out-of-scope behaviour, scores accuracy/safety for RAG, agents and chatbots. Python SDK, web dashboard, CLI, REST API, GitHub Action, and a Claude Code/Cursor agent skill. |
| **QualityClouds (Norma)** | **AI code-governance scanner** — policy compliance, exposed secrets, architecture soundness; delivers a "Production-Ready Score" + verifiable Quality Certified Badge. Runs as an **MCP server** inside Claude Code / Cursor / VS Code / Lovable / Replit, or as a GitHub/Bitbucket full-repo scan with stack auto-discovery. Deterministic output (rule ID, severity, line, fix). |
| **Mastra** | **TypeScript agent framework** (`@mastra/core`) — agents, memory, tools, workflows, scheduled/background tasks, a model router, and **Channels** that put an agent on Telegram/Discord/Slack/WhatsApp/Teams/iMessage. |
| **Titan OS** | Barcelona-based **independent European smart-TV operating system** (Linux + Chromium base), ships on Philips/JVC/AOC, ~18M users across Europe and LatAm, €50M Series A led by Highland Europe (Dec 2025). No public dev API in the challenge — build a TV-shaped UX yourself; they suggest TMDB for catalog data. |
| **Preply** | Language-learning marketplace (150,000+ tutors, 90+ languages, 180 countries). **No API** — theme challenge only. |
| **Make** | **No-code automation / workflow platform** (make.com) — visual scenario builder connecting SaaS apps. **Sponsor with no challenge and no prize.** |
| **Deepfire** | Satellite-AI early wildfire detection. Provides a **unified hotspots/clusters/fire-spread API** for the Norrsken challenge. Founder Louis Cameron Booth is a judge. |

---

## 7. Gaps and things I could NOT verify

1. **No global submission platform named.** No Devpost, no form URL, anywhere on the site, Luma, or in search. Get it at the 11:30 launch.
2. **No demo/pitch length stated** for the Sunday 14:00 demos. (QualityClouds separately wants a 2-minute talk; Mastra wants a 60-second recording.)
3. **No overall judging rubric.** The 5 judges are named (Pedro Gil/Bynd VC, Dani Carmona/Supersonik, Lilibeth Bustos Linares/SOMA AI, Carmen Ansio/Stripe, Louis Cameron Booth/Deepfire) but no criteria or weights for the main 1st/2nd/3rd prizes.
4. **Contradiction:** Mastra's rules say a public repo *"also satisfies the Cognition open-source challenge"*, but the Cognition challenge text on the page never mentions open source. Worth asking Zakee Abdi (Cognition DevRel) whether a public repo is required there.
5. **SLNG's linked hackathon guide (docs.slng.ai/hackathon) is a 404.** No API keys or credit amounts published anywhere I could find.
6. **Preply prize = "To be announced."**
7. **No credit/promo-code amounts published** for Vonage, SLNG, Galtea, QualityClouds, Titan OS, or Devin. Only fal ($1,000 in credits, as a prize not a grant) and Nebius ($1,000/$500/$100 cash + $1,000 credits for overall 1st) are quantified. Assume hackathon keys are handed out on-site.
8. **Address discrepancy:** one third-party listing claims Carrer de Pujades 126; Luma (the organizer's own page) says **Passeig del Mare Nostrum 15**. Trust Luma.

---

## 8. Stacking notes (given the goal of hitting max providers)

The organizers have already blessed two combinations in writing:
- Mastra: *"Nebius Token Factory counts, so one project can enter this and the Nebius challenge."*
- Nebius: *"Teams may combine Token Factory with any other HackBarna sponsor or developer tool."*

Cheapest add-ons (near-zero constraint on what you build):
- **QualityClouds** — *"Norma is not a constraint on what you build"*; requirement is literally scan → fix → rescan + a 2-min talk. Free win on any repo.
- **Galtea** — point it at whatever you built; the only hard gate is the Tally feedback survey.
- **Nebius** — swap your OpenAI base URL. Satisfies "meaningful use" if it's your core inference.
- **Mastra** — TS agent framework; the Telegram channel is the shortest path to "reachable on a real messaging platform."

The expensive/exclusive ones that will fork your architecture: **fal H3 Max Director** (live video generation must be the *core*), **Cognition Devin** (needs a real programmatic verifier + a demonstrable self-recovery run), **Titan OS** (TV-shaped UX), **Vonage Video** (WebRTC calls), **Norrsken/Deepfire** (real geospatial data, pick one of four tracks).

**Highest prize density per unit of work:** Titan OS (a 43" TV *per team member*) and QualityClouds (Keychron V6 8K *per member* for scan/fix/rescan). Highest cash: Nebius ($1,000) and fal ($1,000 credits).

**Make is the only sponsor logo with no challenge** — using make.com adds a provider to your count but wins nothing.

---

## Appendix — judges and mentors (from the page)

**Judges:** Pedro Gil (Associate @ Bynd VC) · Dani Carmona (CEO @ Supersonik) · Lilibeth Bustos Linares (CEO & Founder @ SOMA AI) · Carmen Ansio (Design Systems @ Stripe) · Louis Cameron Booth (Founder @ Deepfire)

**Mentors:** Guillermo Llopis (CTO @ SOMA AI) · Jonne Frankena (AE @ Kapa.ai) · Baptiste Jacquemet (Founder @ Agent Studio) · Manuela Mejia Tobar (Communication Lead @ Norrsken) · Gerard Pijoan (Head of Design @ Titan OS) · Garazi Marques (HR Director @ Titan OS) · David Villanueva (VP Ad-Tech and Data @ Titan OS) · Miquel Barba (CTO @ Titan OS) · Dylan Bristot (Founding PMM @ Nebius) · Mashrur Haider (Founding Tech PM @ Nebius) · Ismael Ordaz (Co-founder @ SLNG) · Tolga Yapici (AI Engineer @ SLNG) · Francisco Javier (ML Engineer @ SLNG) · Dwane Hemmings, Julia Biro, Jorge Ortiz (Developer Advocates @ Vonage) · Lucinda Abberley (Global Community Manager @ Vonage) · Umut Günbak (European Operations & Startups @ fal) · Alper Bahçekapılı (Applied MLE @ fal) · Zakee Abdi (Developer Advocate @ Cognition) · Baybars Külebi (CTO & Co-founder @ Galtea) · Luca Galvani (Founding Marketer @ Galtea) · Guillem Poy (Founding SWE @ Galtea) · Sonia Toqqe (Event Marketing Manager @ Make) · Ignacio Sales (CTO @ Quality Clouds) · Cristian Urraca (VP Engineering @ Quality Clouds) · Nuno Silva (Engineer @ Quality Clouds) · Yasmina Ajouau (Mentor @ Quality Clouds) · Albert Franquesa (CSO @ Quality Clouds)

## Appendix — key URLs

- Event page: https://www.hackbcn.com/en/events/aisummit26
- Registration (Luma, currently "Event Full" + waitlist): https://luma.com/3gswve8n
- Code of Conduct: https://www.hackbcn.com/en/conduct
- Project archive (past editions): https://www.hackbcn.com/en/projects
- Wildfire challenge data: https://www.deepfire.co/hackbarna
- AI Summit Barcelona: https://aisummitbarcelona.com/
- AI Summit startup competition: https://startups.aisummitbarcelona.com/
- Barcelona Event Digest: https://digest.hackbarna.com/en
- Socials: https://x.com/hackbarna · https://instagram.com/hackbarna · https://linkedin.com/company/hackbarna
