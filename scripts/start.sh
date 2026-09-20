#!/usr/bin/env bash
set -euo pipefail

# polsTV production entrypoint: runs the built Mastra server and a headless Chrome/Chromium
# tab that holds the broadcaster page open, and keeps their lifetimes tied together — if
# either dies, this script kills the other and exits non-zero so the platform restarts the
# container. See PLAN.md §3 and docs/CONTRACT.md for what each process does.
#
# Runs unattended in the Docker image (CHROME_BIN defaults to the apt-installed chromium) and
# interactively on macOS for the local production-build check in docs/DEPLOY.md (CHROME_BIN
# points at a real Chrome/Brave install).

missing=()
[[ -z "${BROADCASTER_SECRET:-}" ]] && missing+=(BROADCASTER_SECRET)
[[ -z "${FAL_KEY:-}" ]] && missing+=(FAL_KEY)
[[ -z "${NEBIUS_API_KEY:-}" ]] && missing+=(NEBIUS_API_KEY)
[[ -z "${VONAGE_APPLICATION_ID:-}" ]] && missing+=(VONAGE_APPLICATION_ID)
[[ -z "${VONAGE_PRIVATE_KEY64:-}" ]] && missing+=(VONAGE_PRIVATE_KEY64)
[[ -z "${SLNG_API_KEY:-}" ]] && missing+=(SLNG_API_KEY)
[[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] && missing+=(TELEGRAM_BOT_TOKEN)
if ((${#missing[@]} > 0)); then
  echo "start.sh: missing required env var(s): ${missing[*]}" >&2
  exit 1
fi

port="${PORT:-4111}"
chrome_bin="${CHROME_BIN:-/usr/bin/chromium}"
status_wait_seconds="${STATUS_WAIT_SECONDS:-30}"

if [[ ! -x "$chrome_bin" ]]; then
  echo "start.sh: CHROME_BIN '$chrome_bin' is not an executable file." \
    "Set CHROME_BIN to a Chrome/Chromium/Brave binary." >&2
  exit 1
fi

# mastra build's output has its own package.json + node_modules; on macOS it stays at
# .mastra/output/index.mjs, in the Docker image it is flattened to ./index.mjs (see Dockerfile).
if [[ -f .mastra/output/index.mjs ]]; then
  server_entry=".mastra/output/index.mjs"
elif [[ -f index.mjs ]]; then
  server_entry="index.mjs"
else
  echo "start.sh: no built server found (.mastra/output/index.mjs or ./index.mjs)." \
    "Run 'pnpm build' first." >&2
  exit 1
fi

server_pid=""
chrome_pid=""

cleanup() {
  local status=$?
  trap - EXIT
  # `|| true`: set -e would otherwise abort this function (and skip the second kill) when a
  # child is already gone, since a "no such process" kill exits non-zero.
  [[ -n "$chrome_pid" ]] && kill "$chrome_pid" 2>/dev/null || true
  [[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
# The platform sends SIGTERM to stop/restart the container; forward it to both children via
# the EXIT trap above instead of letting them be orphaned or SIGKILLed after the grace period.
trap 'exit 143' TERM

# macOS only: the broadcaster is a headless tab on someone's laptop, and an idle machine that
# sleeps takes the whole channel off the air. `-w $$` ties the assertion to this script, so it
# lifts the moment the run ends and nobody has to remember to stop it.
if [[ "$(uname -s)" == "Darwin" ]] && command -v caffeinate >/dev/null; then
  caffeinate -dims -w "$$" &
  echo "start.sh: holding the machine awake (caffeinate -dims)"
fi

echo "start.sh: starting server ($server_entry) on port $port"
PORT="$port" node "$server_entry" &
server_pid=$!

status_url="http://127.0.0.1:${port}/status"
waited=0
until node -e "fetch(process.argv[1]).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  "$status_url" 2>/dev/null; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "start.sh: server exited before answering GET /status" >&2
    exit 1
  fi
  waited=$((waited + 1))
  if ((waited >= status_wait_seconds)); then
    echo "start.sh: server did not answer GET /status within ${status_wait_seconds}s" >&2
    exit 1
  fi
  sleep 1
done
echo "start.sh: server is up ($status_url)"

broadcaster_url="http://127.0.0.1:${port}/broadcaster.html?autostart=1"
# Free mode: keeps the bot/ident card up without opening a paid Director session. Used for
# verification here and can be left on in production when credits must be conserved.
[[ "${DIRECTOR:-}" == "off" ]] && broadcaster_url+="&director=off"
broadcaster_url+="#${BROADCASTER_SECRET}"

user_data_dir="$(mktemp -d)"
chrome_args=(
  --headless=new
  # The page's AudioContext starts suspended without a user gesture; headless Chrome never
  # delivers one, so without this flag the broadcaster falls back to publishing video-only
  # (src/mastra/public/broadcaster.html, publishToVonage). Verify per docs/DEPLOY.md that this
  # actually yields a running AudioContext, not just a started one.
  --autoplay-policy=no-user-gesture-required
  # The broadcaster page's operator log is a <div> in a tab nobody can open. It also writes every
  # line to the console, and this is what puts that console in our stderr — otherwise a page that
  # stopped publishing, or lost Director, fails entirely in private.
  --enable-logging=stderr
  --no-first-run
  --disable-dev-shm-usage
  --user-data-dir="$user_data_dir"
)
# --no-sandbox: measured locally (docs/DEPLOY.md) — Chromium's setuid/namespace sandbox needs
# kernel privileges (unprivileged user namespaces or CAP_SYS_ADMIN) a Linux container's non-root
# user does not have by default; headless Chromium as the "node" user in this image exits 1 with
# "No usable sandbox!" without this flag, Fly/Railway give no way to grant that capability, and
# there is no second local user or arbitrary code running in this tab to sandbox against. On
# macOS this is moot (no container, no missing capability), so only add it on Linux.
[[ "$(uname -s)" == "Linux" ]] && chrome_args+=(--no-sandbox)
# Local-only: lets docs/DEPLOY.md's verification step read the page's own operator log over the
# DevTools protocol without disturbing anything else. Never set in production.
[[ -n "${CHROME_DEBUG_PORT:-}" ]] && chrome_args+=(--remote-debugging-port="$CHROME_DEBUG_PORT")
chrome_args+=("$broadcaster_url")

echo "start.sh: starting $chrome_bin"
"$chrome_bin" "${chrome_args[@]}" &
chrome_pid=$!

echo "start.sh: both processes up (server=$server_pid chrome=$chrome_pid)"
while true; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "start.sh: server process exited" >&2
    exit 1
  fi
  if ! kill -0 "$chrome_pid" 2>/dev/null; then
    echo "start.sh: chrome process exited" >&2
    exit 1
  fi
  sleep 2
done
