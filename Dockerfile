# polsTV production image: one container running the built Mastra server and a
# headless Chromium tab that holds the broadcaster page open (PLAN.md §3, docs/CONTRACT.md).
# Multi-stage: the build stage needs the full pnpm toolchain (esbuild, typescript, mastra CLI);
# the runtime stage only needs `mastra build`'s self-contained output plus a browser, so
# splitting them keeps the shipped image free of dev tooling and the ~350MB Chromium install
# is the only thing left dominating its size.
#
# node:22-bookworm-slim, Node 22 LTS. Pin by digest (`docker inspect node:22-bookworm-slim`
# on 2026-09-19); re-pin when bumping Node.
FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS build

# corepack ships with Node 22; pin pnpm to the version this repo's lockfile was made with.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
COPY . .

# --ignore-scripts blocks install/postinstall for every dependency. The only one that needs
# its postinstall is esbuild (used by `mastra build`'s bundler): its script links the
# already-resolved platform binary from its own optionalDependencies, it does not compile or
# fetch anything untrusted. `pnpm rebuild esbuild` re-runs scripts for exactly that package.
# Verified 2026-09-19: no other dependency (prod or dev) declares a preinstall/postinstall script.
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild esbuild
RUN pnpm build

# ---------------------------------------------------------------------------------------------

FROM node:22-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9

# chromium: the broadcaster's headless tab. fonts-liberation: readable ident-card/error text
# without pulling the full Debian font set. ca-certificates: TLS to fal/Nebius/Vonage/SLNG/
# Telegram. dumb-init: PID 1 that reaps zombies and passes signals through to start.sh.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# WORKDIR creates /app as root; the server writes its libsql file (./mastra.db, relative to
# cwd) into this directory at startup, so the non-root "node" user needs to own it, not just
# the files COPY places inside it.
RUN chown node:node /app
# `mastra build` copies src/mastra/public/* next to the bundle (.mastra/output/, not
# output/public/), so flattening that directory here keeps the index.mjs + index.html +
# broadcaster.html layout the `page()` helper in src/mastra/index.ts expects.
COPY --from=build --chown=node:node /app/.mastra/output ./
COPY --chown=node:node scripts/start.sh ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

ENV PORT=4111
ENV CHROME_BIN=/usr/bin/chromium

# node:22-bookworm-slim already ships a non-root "node" user (uid 1000); reuse it instead of
# creating a new one.
USER node

EXPOSE 4111

# No curl in the image (kept out of the apt list on purpose); Node's built-in fetch does the
# same job with nothing extra installed.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4111)+'/status').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["scripts/start.sh"]
