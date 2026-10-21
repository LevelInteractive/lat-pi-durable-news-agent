# Level Agency deploy notes

This fork (`LevelInteractive/lat-pi-durable-news-agent`, upstream `disler/pi-durable-news-agent`) hosts the Durable News Agent as an internal **pilot** at `https://news-agent.dash.level.agency`. Asana: 1219758463265269.

## What we changed vs upstream

| Change | Files | Why |
| --- | --- | --- |
| `DNA_PROVIDER=anthropic`: the catalog's Claude models straight through the Anthropic API (`ANTHROPIC_API_KEY`). OpenRouter stays the upstream default, so the change is additive. | `apps/shared/packages/durable-agent/src/models.ts`, `apps/dna-server-api/src/config.ts`, `src/runtime.ts`, `apps/dna-cli/src/doctor.ts` | We don't use OpenRouter. Catalog ids stay `anthropic/claude-haiku-5.5` etc. (settings, UI and defaults use them); refs carry the Anthropic API id (`claude-haiku-5-5`). The picker lists the 7 Claude models only. |
| jev on TypeSafe direct sends `jev-latest`, not OpenRouter's `~typesafe/jev-latest`. | `apps/shared/packages/jev/src/client.ts` | Every jev command pins the OpenRouter name, which TypeSafe rejects with HTTP 400. This is an upstream bug: `JEV_BACKEND=typesafe` never worked. |
| Hosting overlay | `deploy/Dockerfile`, `deploy/entrypoint.sh`, `.dockerignore`, this file | Single-container deploy on Dokploy |
| Tests | `durable-agent/tests/harness.test.ts`, `dna-server-api/tests/provider.test.ts`, `jev/tests/client.test.ts`, `jev/tests/live.test.ts` (honours `JEV_BACKEND=typesafe`) | |

## Container

- **Image**: `deploy/Dockerfile`, build context = repo root. It runs `npm ci` with devDependencies (the apps run TypeScript through `tsx`) and builds the Vue UI (`vite build`). Node 24, `TZ=America/New_York`.
- **Processes** (`deploy/entrypoint.sh`, bash supervisor):
  - API `dna-server-api` on `127.0.0.1:4850`
  - hub `dna-client-browser` on `0.0.0.0:4851`. It serves the UI and proxies `/api/*` with the client token. **Traefik targets 4851.**
  - tick: every 60 s, the same `dna-server-cron tick` the upstream crontab runs. It POSTs `/v1/workflows/news-sweep` with the cron token. The API's schedule decides whether a sweep starts: every 5 min by default, and you change it in the UI. A failed tick is logged and retried; it never stops the container.
  - If the API or the hub exits, the entrypoint stops the rest and exits non-zero, so Swarm restarts the container. SIGTERM shuts it down cleanly.
- **User and volume**: the container starts as root only to `chown` anything under `/data` that the `node` user (uid 1000) doesn't own. It uses `find ! -user`, so restarts stay fast. Then it re-execs itself as `node` via `gosu`. `/app` stays root-owned and read-only to the app.
- **State** on the `/data` volume: `dna.sqlite`, `agent.sqlite`, lockfiles, generated card images and `logs/*.jsonl`. Logs also go to stderr (`DNA_LOG_PRETTY=1`).
- **Health**:
  - through the hub: `GET /api/healthz` (proves hub and API; this is the Docker HEALTHCHECK). The hub alone answers `GET /hub/healthz`.
  - API directly, inside the container: `GET http://127.0.0.1:4850/healthz`
  - all three are open (no token).
- **Auth**: Traefik forward-auth (Google SSO) gates the host. The app has no login. The hub holds `DNA_CLIENT_TOKEN`, and its guard only answers Hosts and Origins it serves: localhost plus `DNA_PUBLIC_HOST`.

## Env

| Var | Default in image | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (required) | agents |
| `TYPESAFE_API_KEY` | (required) | jev |
| `OPENAI_API_KEY` | (optional) | card images when a source has none |
| `DNA_CLIENT_TOKEN`, `DNA_CRON_TOKEN` | (required) | 32+ chars each, and they must differ |
| `DNA_PROVIDER` | `anthropic` | `anthropic`, `openrouter` or `faux` |
| `DNA_MODEL`, `DNA_RESEARCH_MODEL` | `anthropic/claude-haiku-5.5` | catalog ids (not API ids) |
| `JEV_BACKEND` | `typesafe` | |
| `DNA_SEARCH_MODE` | `web` | free engines (Bing/Google News RSS, HN) |
| `DNA_DATA_DIR` / `DNA_LOG_DIR` | `/data` / `/data/logs` | |
| `DNA_DEVICE_NAME` | `dokploy` | names the cron slot ids |
| `DNA_PUBLIC_HOST` | `news-agent.dash.level.agency` | appended to the hub's `DNA_HUB_HOSTS` allowlist |
| `DNA_PORT` / `DNA_HUB_PORT` | `4850` / `4851` | |
| `DNA_TICK_SECONDS` | `60` | tick loop interval |
| `DNA_ENV_FILE` | `none` | no `.env` file in the container |

## Upstream sync

`git fetch upstream && git merge upstream/main`, then re-run the free suites under Node 24:

- `npm run check`
- `npm test`
- the faux list in `just/test/mod.just`

Expect conflicts only in the files in the table above. If upstream adds a Claude model to `CATALOG`, the anthropic path picks it up as long as pi-ai's Anthropic catalog knows its id. If it doesn't, startup fails with `Anthropic catalog is missing: …`.

## Rollback

Redeploy the previous image or commit from Dokploy. The `/data` SQLite schema migrates forward only, so going back across an upstream schema change means restoring a `/data` backup.
