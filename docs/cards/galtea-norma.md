# Galtea + Norma — integration card (verified 2026-09-19)

Claims tagged **V** (verified, source given) or **U** (unverified — check it). Research only.

## GALTEA

### 1. Signup, API key, free tier
- **V** Sign up at https://platform.galtea.ai/ — "registration is open and takes less than a minute";
  email/password, Google, GitHub, GitLab. (docs.galtea.ai/registration)
- **V** Key: **Settings > Generate API Key**, https://platform.galtea.ai/settings; prefix `gsk_`/`gsk-`.
  REST base `https://api.galtea.ai`, `Authorization: Bearer gsk_...`. (quickstart, sdk/usage, api-reference)
- **V** Free tier: €0/mo, **1,500 credits/month**, **1 user**, **2 products**, 90-day retention, all
  features, no roll-over. Costs: red-team **case = 1 credit**, **LLM-judge evaluation = 2**, simulation
  turn = 3. (galtea.ai/pricing) **U** No documented env var; docs always pass `api_key=` to the ctor.

### 2. Shortest path for our TypeScript agent behind HTTP
Two supported paths. **Take A on Sunday.**

**A. Python script + local `agent=` callable (recommended).** Galtea calls *your function*; the function
does the HTTP POST. Works against `localhost`, no deploy, no HTTPS.
- **V** `evaluations.run(version_id=..., agent=...)`; `agent` accepts `(str) -> str`,
  `(list[dict]) -> str`, or `(AgentInput) -> AgentResponse`. (sdk/api/evaluation/run)

**B. Endpoint Connection (server-side, Galtea calls us).** **V** `galtea.endpoint_connections.create(
name, product_id, url, type=CONVERSATION, http_method, auth_type, auth_token, input_template,
output_mapping, timeout)` — `input_template` Jinja2 (`'{"message": "{{ input.user_message }}"}'`),
`output_mapping` JSONPath (`{"output": "$.response"}`), types `INITIALIZATION|CONVERSATION|FINALIZATION`,
auth `NONE|BEARER|API_KEY|BASIC`, timeout default 15 max 120 (sdk/api/endpoint-connection/create). Then
`evaluations.run(version_id=...)` with no `agent=` uses "the server-side endpoint connection pipeline".
- **Gotcha (V):** `url` is **HTTPS-only** → B cannot hit localhost. Only viable after the Sat-night
  deploy. A has no such constraint, which is why A wins.

**Minimal end-to-end (path A).** Calls are verified individually; the assembly is **U** — run it once.
```python
# pip install galtea==5.3.1
import requests
from galtea import Galtea

galtea = Galtea(api_key="gsk_...")

product = galtea.products.get_by_name(name="TeleSlop Showrunner")   # created in the UI, see gotcha
version = galtea.versions.create(name="v1-baseline", product_id=product.id,
                                 description="moderation prompt before fix")

dataset = galtea.datasets.create(
    name="showrunner-redteam-v1",
    type="SECURITY",
    product_id=product.id,
    variants=["toxicity"],
    strategies=["original", "role_play", "base64"],
    max_test_cases=20,
)

def showrunner(user_message: str) -> str:
    r = requests.post("http://localhost:4111/say", json={"text": user_message}, timeout=30)
    return r.json()["prompt"]        # refusal string or rewritten prompt

result = galtea.evaluations.run(version_id=version.id, agent=showrunner)
completed = galtea.evaluations.wait_for(evaluation_ids=[e.id for e in result["evaluations"]])
```
- **Gotcha (V):** the SDK has **no `products.create`** — Product Service is only list/get/get_by_name/
  delete. Create the product and paste the one-line spec in the platform onboarding UI, then
  `get_by_name`. `create-product` exists in the REST API only. (docs.galtea.ai/llms.txt)
- **Gotcha (V→U):** `run()` resolves datasets and metrics **through specifications** — no `dataset_id`
  or `metrics` args exist. (sdk/api/evaluation/run) Whether a SECURITY dataset must be explicitly linked
  to a Specification is **U**, but `specifications.link_datasets`/`link_metrics` exist — budget 10 min
  for create specification → link dataset → link metrics → run.

### 3. Metrics / dataset type for "refuses real people, NSFW, prompt injection; stays in scope"
- **V** Dataset types `ACCURACY | SECURITY | BEHAVIOR`; ours is **SECURITY**. (concepts/product/dataset)
- **V** Recommended SECURITY metrics: **Misuse Resilience, Jailbreak Resilience, Non-Toxic, Data
  Leakage**. (dataset/security-datasets) "Stays in scope" → **Role Adherence**. (llms.txt)
- **V** Threats (`variants`): Data Leakage, Financial Attacks, Illegal Activities, Misuse, Toxicity,
  **Custom** ("target the unique vulnerabilities and edge cases of your AI product"). Use Custom +
  `custom_variant_description` for "no real people". (dataset/security-threats)
- **V** 18 strategies: original, base64, hex, homoglyph, leetspeak, morse code, rot13, zero width
  insertion, emoji obfuscation, biblical, math prompt, **role play**, **prefix**, persuasive content,
  creative writing, data analysis, **bait and switch**, empathetic framing (bold = our prompt-injection
  coverage). (dataset/security-strategies)
- **Gotcha (U):** only `"toxicity"`, `"original"`, `"role_play"`, `"base64"` are verified as exact
  argument strings. Casing of the rest is **U**; a bad enum fails at dataset creation, so try one first.

### 4. Before/after comparison and where results live
- **V** **Versions** are the comparison unit — "compare different implementations against identical
  datasets", measure improvements, identify regressions. `parent_version_id` records lineage, but
  "Lineage is **provenance only**… does not change how the version… is compared." (concepts/product/version)
- Plan: v1-baseline → find failure → fix prompt → `versions.create("v2-fixed", parent_version_id=v1.id)`
  → re-run the **same** dataset → screenshot both.
- **V** Results live at https://platform.galtea.ai/; "cross-version analytics comparison insights" and
  "per-version scores" exist as API surfaces (llms.txt, api-reference/analytics/*). **U** No documented
  public/shareable results link — screenshot both runs for the judges.

### 5. Claude Code agent skill
- **V** `/plugin marketplace add Galtea-AI/skills` then `/plugin install galtea@galtea`. Alternatives:
  `npx skills add Galtea-AI/skills --skill "galtea"`, or ask the agent to "Install the Galtea Agent Skill
  from github.com/Galtea-AI/skills"; manual = symlink into `~/.claude/skills`. (sdk/integrations/agent-skill)
- **V** Automates auth, endpoint discovery, running evaluations, **polling async results**, displaying
  findings. Example prompt: "Run an evaluation for version `<id>` and show me the failures."

### 6. Wall-clock for ~50 tests
- **U** Not stated anywhere — no duration, async or polling figures in the docs.
- **V (arithmetic on verified prices)** Budget credits instead: 50 cases × 4 metrics = 50 + 400 = **450
  credits**; the re-run reuses the dataset = **400**. That is 850 of 1,500 free monthly credits for one
  before/after. **Use `max_test_cases=20` + 2 metrics → 100 then 80 = 180 credits.** Runs are async
  (`wait_for`), so start the run and do Norma while it scores.
- **V** Galtea ships an SLNG.ai integration page (sdk/integrations/slng) — tell card-slng.

## NORMA (Quality Clouds)

### 7. Add the MCP server to Claude Code
- **V** `claude mcp add --scope user --transport http norma https://api.qualityclouds.ai/mcp`
  (github.com/qualityclouds/norma-mcp). Marketing page gives the same minus `--scope user`.
- **V** Auth is **OAuth** — browser opens on first connection, "under 30 seconds". No key to collect
  tonight. Free tier permanent, not a trial.
- **V** Stacks include **TypeScript, JavaScript, Node, React, Vite, Python, PHP, Supabase, FastAPI,
  SQLAlchemy, Magento** — our Node 22 + TS repo qualifies.
- **V** Six tools: `link_repository`, `get_rulesets`, `get_rules_for_ruleset`, `live_check`
  (deterministic per-file validation), `get_open_issues` (issues from the **last repository scan**),
  `register_applied_actions` (compliance audit trail).
- **Gotcha (V facts → U inference):** there is **no `scan` tool over MCP**. `live_check` is per-file and
  `get_open_issues` reads the *last* scan. So scan → fix → rescan is almost certainly: connect repo + run
  **Full Scan** in the web app → fix in Claude Code via `live_check` + `get_open_issues` →
  `register_applied_actions` → Full Scan again. Confirm on first contact; it shapes the demo script.

### 8. Where judges see the score and audit trail
- **V** **Production-Ready Score** + **Quality Certified badge** for the README; the badge links to a
  **public verification page** with the live score, its composing areas and every issue by severity,
  openable by anyone. Every finding records **rule, version, file, line, commit, author, timestamp**.
  Norma also bands AI-authored share: Native <30%, Hybrid 30–70%, Delegated >70%. (qualityclouds.ai/norma)
- **V** Dashboard **norma.qualityclouds.com**. Worked example: the demo repo scores **81/100**, 63
  findings (42 high), Performance 59% / Security 91%. (qualityclouds/Norma-byQualityClouds-demo-repo)
- **Discrepancy (V):** marketing says "six quality areas", the demo README says five dimensions — say
  "the areas Norma reports" in the 2-min talk, not a number.

### 9. GitHub full-scan alternative
- **V** Fork the repo → free account at norma.qualityclouds.com → connect the fork → fix findings (each
  ships a ready-to-use fix) → re-scan to track the score. GitHub or Bitbucket, "deterministic audit of the
  whole repository", in memory, weekly full scans. (demo-repo README, qualityclouds.ai/norma)
- **V** Free quota: 1 developer, 1 workspace, **1 repository**, **5 Full Scans per week**, score + badge,
  **unlimited editor enforcement through MCP** — enough for scan/fix/rescan with spares.
  Pro is $199/mo (100 scans/mo, all 198 rules); not needed. (qualityclouds.ai/drafts/pricing/norma)
  **U** Full Scan duration is not stated — start it first, then do Galtea.

## BOTH — versions and gotchas

- **V** `galtea` on PyPI: **5.3.1**, uploaded 2026-09-17, `requires_python >=3.9`. Pin `galtea==5.3.1`.
  (pypi.org/pypi/galtea/json, checked today)
- **V** Norma has **no npm or PyPI package** — `norma-mcp` and `@qualityclouds/norma-mcp` both 404 on the
  npm registry. Hosted HTTP MCP endpoint only; repo last pushed 2026-08-31.
- **Gotcha (V):** galtea **5.0.0 renamed entities** (Dataset/Trace/Span). Any 4.x snippet on the web —
  `galtea.tests.create`, "test" for "dataset" — is stale; see sdk/migration-guides/entity-renames. Ignore
  the page still named `concepts/product/test`.
- **Gotcha (V):** free tier allows **2 products** and 1 user — don't burn a slot on a throwaway.
- **Gotcha (PLAN.md):** the **Tally survey is a hard gate** for the Galtea prize,
  https://tally.so/r/J9Pyar — fill it even if the run goes badly.
- Sunday order that respects the async waits: Norma OAuth + repo connect + Full Scan **first** (runs while
  you work) → Galtea product in the UI → dataset (20 cases) → baseline run → fix prompt → v2 run →
  screenshots → Norma fix + rescan + `register_applied_actions` → Tally survey.
