# Level Agency hosting overlay for the Durable News Agent (see LEVEL_DEPLOY.md).
#
# Lives under deploy/ so upstream syncs never conflict. Dokploy builds THIS file with context = repo root.
# One container runs the API (127.0.0.1:4850), the browser hub (0.0.0.0:4851, Traefik's target) and the
# every-minute sweep tick, supervised by deploy/entrypoint.sh. State lives on the /data volume.
#
# The apps run their TypeScript through tsx (a root devDependency), so the image keeps devDependencies.
# Auth: news-agent.dash.level.agency is gated by Traefik forward-auth (Google SSO); the hub holds the
# API's client token itself.

FROM node:24-bookworm-slim

ENV TZ=America/New_York \
    NODE_NO_WARNINGS=1 \
    npm_config_update_notifier=false \
    DNA_PROVIDER=anthropic \
    JEV_BACKEND=typesafe \
    DNA_SEARCH_MODE=web \
    DNA_DATA_DIR=/data \
    DNA_LOG_DIR=/data/logs \
    DNA_LOG_PRETTY=1 \
    DNA_ENV_FILE=none \
    DNA_DEVICE_NAME=dokploy \
    DNA_HOST=127.0.0.1 \
    DNA_PORT=4850 \
    DNA_HUB_HOST=0.0.0.0 \
    DNA_HUB_PORT=4851 \
    DNA_PUBLIC_HOST=news-agent.dash.level.agency

RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata gosu ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && gosu nobody true

WORKDIR /app

# Dependencies first (cached until a package.json or the lockfile changes).
COPY package.json package-lock.json ./
COPY apps/shared/packages/dna-sdk/package.json apps/shared/packages/dna-sdk/
COPY apps/shared/packages/jev/package.json apps/shared/packages/jev/
COPY apps/shared/packages/durable-agent/package.json apps/shared/packages/durable-agent/
COPY apps/dna-cli/package.json apps/dna-cli/
COPY apps/dna-client-browser/package.json apps/dna-client-browser/
COPY apps/dna-client-tui/package.json apps/dna-client-tui/
COPY apps/dna-server-api/package.json apps/dna-server-api/
COPY apps/dna-server-cron/package.json apps/dna-server-cron/
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY . .
# Build the Vue UI (the hub serves fe/dist and would try to rebuild at start if it were older than fe/src).
RUN cd apps/dna-client-browser && npx vite build --config fe/vite.config.ts \
 && test -f fe/dist/index.html \
 && chmod +x /app/deploy/entrypoint.sh

# /app stays root-owned and read-only to the app user; everything it writes goes under /data.
# Dokploy mounts the persistent volume at /data.
RUN mkdir -p /data && chown node:node /data

EXPOSE 4851
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4851/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Starts as root to fix /data ownership, then drops to the node user (uid 1000) via gosu.
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
