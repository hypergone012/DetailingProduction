#!/usr/bin/env bash
# Local Supabase-compatible stack built from the real upstream components (no Docker):
#   PostgreSQL 16      :54322  (.local/pg)
#   Supabase Auth      :54324  (GoTrue, built from source at a pinned commit)
#   PostgREST 13       :54325  (official static binary)
#   Supabase Storage   :54326  (storage-api from source, file backend)
#   Gateway            :54321  (`pnpm functions:serve`: /auth/v1, /rest/v1, /storage/v1, /functions/v1)
#
# Usage: scripts/local/stack.sh <init|start|stop|status|reset|createdb NAME|dropdb NAME|psql ...>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL="$ROOT/.local"
PGDATA="$LOCAL/pg"
PGPORT="${DP_PG_PORT:-54322}"
AUTH_PORT="${DP_AUTH_PORT:-54324}"
REST_PORT="${DP_REST_PORT:-54325}"
STORAGE_PORT="${DP_STORAGE_PORT:-54326}"
DB="${DP_DB:-dp_dev}"
# AUTH_COMMIT, STORAGE_COMMIT, POSTGREST_VERSION, NODE24_VERSION: shared with the server build.
# shellcheck source=../../deploy/server/versions.env
. "$ROOT/deploy/server/versions.env"
NODE24="$LOCAL/node24/package/bin"
AUTH_SRC="$LOCAL/src/auth"
STORAGE_SRC="$LOCAL/src/storage"
BIN="$LOCAL/bin"
JWT_SECRET="${DP_JWT_SECRET:-local-dev-jwt-secret-with-at-least-32-characters}"
SITE_URL="${DP_SITE_URL:-http://127.0.0.1:5173}"

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PGBIN" ] || PGBIN="$(dirname "$(command -v pg_ctl)")"

as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

psql_local() {
  PGOPTIONS="-c client_min_messages=warning" psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q "$@"
}

wait_http() {
  local url="$1" name="$2" log="$3"
  for _ in $(seq 1 100); do
    curl -fsS "$url" >/dev/null 2>&1 && { echo "$name ready"; return 0; }
    sleep 0.2
  done
  echo "$name failed to start, see $log" >&2; tail -20 "$log" >&2; exit 1
}

ensure_keys() {
  [ -f "$LOCAL/keys.json" ] || (cd "$ROOT" && npx tsx scripts/local/keys.ts >/dev/null)
}

json_key() { node -e "process.stdout.write(require('$LOCAL/keys.json')['$1'])"; }

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

build_auth() {
  [ -x "$BIN/gotrue" ] && return
  mkdir -p "$LOCAL/src" "$BIN"
  [ -d "$AUTH_SRC/.git" ] || git clone -q --filter=blob:none https://github.com/supabase/auth "$AUTH_SRC"
  git -C "$AUTH_SRC" checkout -q "$AUTH_COMMIT"
  (cd "$AUTH_SRC" && GOTOOLCHAIN=auto go build -o "$BIN/gotrue" .)
}

fetch_postgrest() {
  [ -x "$BIN/postgrest" ] && return
  mkdir -p "$BIN"
  curl -fsSL -o "$LOCAL/postgrest.tar.xz" \
    "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x86-64.tar.xz"
  tar xJf "$LOCAL/postgrest.tar.xz" -C "$BIN" && rm "$LOCAL/postgrest.tar.xz"
}

fetch_node24() {
  [ -x "$NODE24/node" ] && return
  mkdir -p "$LOCAL/node24"
  (cd "$LOCAL/node24" && npm pack -q "node-linux-x64@$NODE24_VERSION" >/dev/null && tar xzf node-linux-x64-*.tgz && rm -f node-linux-x64-*.tgz)
}

build_storage() {
  [ -f "$STORAGE_SRC/dist/start/server.js" ] && return
  fetch_node24
  mkdir -p "$LOCAL/src"
  if [ ! -d "$STORAGE_SRC/.git" ]; then
    git clone -q --filter=blob:none https://github.com/supabase/storage "$STORAGE_SRC"
  fi
  git -C "$STORAGE_SRC" fetch -q --depth 1 origin "$STORAGE_COMMIT" 2>/dev/null || true
  git -C "$STORAGE_SRC" checkout -q "$STORAGE_COMMIT"
  (cd "$STORAGE_SRC" && export PATH="$NODE24:$PATH" && npx -y npm@11.21.0 ci --no-audit --no-fund >/dev/null \
    && node ./build.js && npx resolve-tspaths >/dev/null)
}

auth_env() {
  local db="$1"
  export GOTRUE_DB_DRIVER=postgres
  export DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:$PGPORT/$db?sslmode=disable"
  export GOTRUE_DB_MIGRATIONS_PATH="$AUTH_SRC/migrations"
  export API_EXTERNAL_URL="http://127.0.0.1:54321/auth/v1"
  export GOTRUE_SITE_URL="$SITE_URL"
  export GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:5173/**,http://localhost:5173/**,http://127.0.0.1:4173/**"
  export GOTRUE_API_HOST=127.0.0.1
  export PORT="$AUTH_PORT"
  export GOTRUE_JWT_SECRET="$JWT_SECRET"
  export GOTRUE_JWT_EXP=3600
  export GOTRUE_JWT_ISSUER="http://127.0.0.1:54321/auth/v1"
  export GOTRUE_JWT_AUD=authenticated
  export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
  export GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_DISABLE_SIGNUP=true
  export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
  export GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false
  export GOTRUE_MAILER_AUTOCONFIRM=true
  export GOTRUE_LOG_LEVEL=warn
}

migrate_auth() {
  local db="$1"
  ( auth_env "$db"; "$BIN/gotrue" migrate >/dev/null )
  psql_local -d "$db" -f "$ROOT/supabase/local/after-auth.sql"
}

storage_env() {
  local db="$1"
  export SERVER_HOST=127.0.0.1 SERVER_PORT="$STORAGE_PORT" SERVER_ADMIN_PORT=$((STORAGE_PORT + 100)) SERVER_REGION=local
  export AUTH_JWT_SECRET="$JWT_SECRET" AUTH_JWT_ALGORITHM=HS256
  export DATABASE_URL="postgresql://supabase_storage_admin:postgres@127.0.0.1:$PGPORT/$db"
  export DB_INSTALL_ROLES=false DB_ANON_ROLE=anon DB_SERVICE_ROLE=service_role DB_AUTHENTICATED_ROLE=authenticated DB_SUPER_USER=postgres
  export DB_ALLOW_MIGRATION_REFRESH=false
  export STORAGE_BACKEND=file STORAGE_FILE_BACKEND_PATH="$LOCAL/storage-data" STORAGE_FILE_ETAG_ALGORITHM=md5
  export GLOBAL_S3_BUCKET=local-bucket
  export TENANT_ID=local
  export UPLOAD_FILE_SIZE_LIMIT=52428800 UPLOAD_FILE_SIZE_LIMIT_STANDARD=52428800
  export IMAGE_TRANSFORMATION_ENABLED=false RATE_LIMITER_ENABLED=false PG_QUEUE_ENABLE=false
  export OTEL_METRICS_ENABLED=false PROMETHEUS_METRICS_ENABLED=false LOGFLARE_ENABLED=false
  export LOG_LEVEL=warn NODE_ENV=production
  export ANON_KEY="$(json_key anonKey)" SERVICE_KEY="$(json_key serviceRoleKey)"
}

create_db() {
  local db="$1"
  psql_local -d postgres -c "drop database if exists \"$db\" with (force)"
  psql_local -d postgres -c "create database \"$db\""
  psql_local -d "$db" -f "$ROOT/supabase/local/bootstrap.sql"
  migrate_auth "$db"
  echo "database $db ready (platform bootstrap + auth schema)"
}

start_pg() {
  if as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then return; fi
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -w start >/dev/null
  echo "postgres :$PGPORT"
}

init_pg() {
  mkdir -p "$LOCAL"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA"
    [ "$(id -u)" = "0" ] && chown postgres:postgres "$PGDATA"
    as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    cat >> "$PGDATA/postgresql.conf" <<CONF
port = $PGPORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$PGDATA'
max_connections = 300
timezone = 'UTC'
fsync = off
synchronous_commit = off
CONF
  fi
}

start_auth() {
  pid_alive "$LOCAL/gotrue.pid" && return
  ( auth_env "$DB"; nohup "$BIN/gotrue" serve >"$LOCAL/gotrue.log" 2>&1 & echo $! >"$LOCAL/gotrue.pid" )
  wait_http "http://127.0.0.1:$AUTH_PORT/health" "auth :$AUTH_PORT" "$LOCAL/gotrue.log"
}

start_rest() {
  pid_alive "$LOCAL/postgrest.pid" && return
  (
    export PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:$PGPORT/$DB"
    export PGRST_DB_SCHEMAS="public" PGRST_DB_ANON_ROLE=anon PGRST_DB_EXTRA_SEARCH_PATH="public,extensions"
    export PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$REST_PORT"
    export PGRST_ADMIN_SERVER_PORT=$((REST_PORT + 100)) PGRST_DB_MAX_ROWS=1000 PGRST_DB_CHANNEL_ENABLED=true
    export PGRST_LOG_LEVEL=warn
    nohup "$BIN/postgrest" >"$LOCAL/postgrest.log" 2>&1 & echo $! >"$LOCAL/postgrest.pid"
  )
  wait_http "http://127.0.0.1:$((REST_PORT + 100))/ready" "rest :$REST_PORT" "$LOCAL/postgrest.log"
}

start_storage() {
  [ -f "$STORAGE_SRC/dist/start/server.js" ] || { echo "storage not built yet (run: $0 init) - skipped" >&2; return 0; }
  pid_alive "$LOCAL/storage.pid" && return
  mkdir -p "$LOCAL/storage-data"
  ( storage_env "$DB"; cd "$STORAGE_SRC"; nohup "$NODE24/node" dist/start/server.js >"$LOCAL/storage.log" 2>&1 & echo $! >"$LOCAL/storage.pid" )
  wait_http "http://127.0.0.1:$STORAGE_PORT/status" "storage :$STORAGE_PORT" "$LOCAL/storage.log"
}

stop_pidfile() { if [ -f "$1" ]; then kill "$(cat "$1")" 2>/dev/null || true; rm -f "$1"; fi; }

stop_services() {
  stop_pidfile "$LOCAL/storage.pid"
  stop_pidfile "$LOCAL/postgrest.pid"
  stop_pidfile "$LOCAL/gotrue.pid"
}

case "${1:-}" in
  init)
    build_auth; fetch_postgrest; build_storage; init_pg; start_pg; create_db "$DB" ;;
  init-db)
    init_pg; start_pg; create_db "$DB" ;;
  start)
    ensure_keys; start_pg; start_auth; start_rest; start_storage ;;
  stop)
    stop_services; as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true; echo stopped ;;
  restart-services)
    stop_services; sleep 0.3; start_auth; start_rest; start_storage ;;
  status)
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status | head -1 || true
    curl -fsS "http://127.0.0.1:$AUTH_PORT/health" >/dev/null 2>&1 && echo "auth up" || echo "auth down"
    curl -fsS "http://127.0.0.1:$((REST_PORT + 100))/ready" >/dev/null 2>&1 && echo "rest up" || echo "rest down"
    curl -fsS "http://127.0.0.1:$STORAGE_PORT/status" >/dev/null 2>&1 && echo "storage up" || echo "storage down" ;;
  reset)
    # Storage must migrate its schema before the project migrations create buckets/policies.
    ensure_keys; stop_services; sleep 0.3; start_pg; create_db "$DB"; start_auth; start_rest; start_storage
    echo "next: pnpm db:migrate" ;;
  createdb) start_pg; create_db "${2:?db name}" ;;
  dropdb) psql_local -d postgres -c "drop database if exists \"${2:?db name}\" with (force)" ;;
  psql) shift; psql_local -d "$DB" "$@" ;;
  *) echo "usage: $0 <init|start|stop|restart-services|status|reset|createdb NAME|dropdb NAME|psql ...>" >&2; exit 2 ;;
esac
