#!/bin/bash
# Container entrypoint for the Level-hosted Durable News Agent (see LEVEL_DEPLOY.md).
#
# One process tree, supervised here:
#   api   dna-server-api on 127.0.0.1:$DNA_PORT (agents, jev, SQLite under $DNA_DATA_DIR)
#   hub   dna-client-browser on $DNA_HUB_HOST:$DNA_HUB_PORT (built Vue UI + /api proxy holding the client token)
#   tick  what `dna-server-cron tick` does from a crontab, every $DNA_TICK_SECONDS (no OS cron in the container)
# If the api or the hub exits, everything stops and the container exits non-zero so Swarm restarts it.
#
# Started as root only to fix the volume's ownership, then re-executes itself as $DNA_USER via gosu.
set -euo pipefail

APP_DIR="${DNA_APP_DIR:-/app}"
DNA_USER="${DNA_USER:-node}"
export DNA_DATA_DIR="${DNA_DATA_DIR:-/data}"

log() { echo "[level-entrypoint] $*"; }

if [ "$(id -u)" = "0" ]; then
  # A fresh Docker volume (or a host bind mount) may be root-owned. Only touch what is not ours, so a restart
  # with a big /data stays fast.
  mkdir -p "$DNA_DATA_DIR"
  # -h: chown a symlink itself, never what it points at (a restored /data could link outside the volume).
  find "$DNA_DATA_DIR" -xdev ! -user "$DNA_USER" -exec chown -h "$DNA_USER:$DNA_USER" {} +
  exec gosu "$DNA_USER" "$0" "$@"
fi

export DNA_LOG_DIR="${DNA_LOG_DIR:-$DNA_DATA_DIR/logs}"
export DNA_ENV_FILE="${DNA_ENV_FILE:-none}"
export DNA_PORT="${DNA_PORT:-4850}"
export DNA_HOST="${DNA_HOST:-127.0.0.1}"
export DNA_HUB_HOST="${DNA_HUB_HOST:-0.0.0.0}"
export DNA_HUB_PORT="${DNA_HUB_PORT:-4851}"
export DNA_API_URL="${DNA_API_URL:-http://127.0.0.1:$DNA_PORT}"
# The hub answers only for localhost and the hosts it serves (DNS-rebinding / CSRF guard).
if [ -n "${DNA_PUBLIC_HOST:-}" ]; then
  export DNA_HUB_HOSTS="${DNA_HUB_HOSTS:+$DNA_HUB_HOSTS,}$DNA_PUBLIC_HOST"
fi
TICK_SECONDS="${DNA_TICK_SECONDS:-60}"
if ! [[ "$TICK_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  log "FATAL: DNA_TICK_SECONDS must be a positive integer, got '$TICK_SECONDS'"
  exit 1
fi
NODE="${DNA_NODE:-node}"

if [ ! -w "$DNA_DATA_DIR" ]; then
  log "FATAL: $DNA_DATA_DIR is not writable by $(id -un) ($(id -u))"
  exit 1
fi
mkdir -p "$DNA_LOG_DIR"
# Fail at start, not on the first sweep, when the provider keys are missing.
required=(DNA_CLIENT_TOKEN DNA_CRON_TOKEN)
[ "${DNA_PROVIDER:-}" = "anthropic" ] && required+=(ANTHROPIC_API_KEY)
[ "${DNA_PROVIDER:-openrouter}" = "openrouter" ] && required+=(OPENROUTER_API_KEY)
[ "${JEV_BACKEND:-}" = "typesafe" ] && required+=(TYPESAFE_API_KEY)
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    log "FATAL: $name is not set"
    exit 1
  fi
done

pids=()
stopping=0
stop_all() {
  stopping=1
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  wait || true
}
trap 'log "signal received, stopping"; stop_all; exit 0' TERM INT

(cd "$APP_DIR/apps/dna-server-api" && exec "$NODE" --import tsx src/main.ts) &
api_pid=$!
pids+=("$api_pid")

api_up() { "$NODE" -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" \
  "$DNA_API_URL/healthz"; }
for _ in $(seq 1 120); do
  api_up && break
  kill -0 "$api_pid" 2>/dev/null || break
  sleep 1
done
if ! api_up; then
  log "FATAL: dna-server-api did not become healthy"
  stop_all
  exit 1
fi
log "api up on $DNA_API_URL"

(cd "$APP_DIR/apps/dna-client-browser" && exec "$NODE" --import tsx hub/src/main.ts --port "$DNA_HUB_PORT") &
hub_pid=$!
pids+=("$hub_pid")

# The tick: the API decides from its schedule whether this minute starts a sweep. A failed tick is logged and
# retried next minute; it never takes the container down.
(
  # Never let one bad iteration end the loop; the supervisor below exits if the loop itself dies.
  set +e
  child=""
  # Children run in the background and are waited on, so TERM is handled at once, not after a 5 minute tick.
  trap '[ -n "$child" ] && kill -TERM "$child" 2>/dev/null; exit 0' TERM
  cd "$APP_DIR/apps/dna-server-cron"
  while true; do
    started=$(date +%s)
    timeout 300 "$NODE" --import tsx src/main.ts tick &
    child=$!
    wait "$child" || log "tick failed (exit $?)"
    elapsed=$(($(date +%s) - started))
    sleep $((elapsed < TICK_SECONDS ? TICK_SECONDS - elapsed : 1)) &
    child=$!
    wait "$child"
  done
) &
tick_pid=$!
pids+=("$tick_pid")
log "hub on $DNA_HUB_HOST:$DNA_HUB_PORT, tick every ${TICK_SECONDS}s"

# Exit when the api, the hub or the tick loop exits (none of them exits on its own).
set +e
wait -n "$api_pid" "$hub_pid" "$tick_pid"
code=$?
if [ "$stopping" = "0" ]; then
  log "a supervised process exited (code $code); stopping the container"
  stop_all
  exit $((code == 0 ? 1 : code))
fi
