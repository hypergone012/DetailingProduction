#!/usr/bin/env bash
# Installs or updates the platform on one Ubuntu 24.04 server. Run as root by the deploy
# (scripts/server/deploy.sh), which first uploads:
#   /opt/dp/incoming/platform-<id>.tar.gz   PostgREST, Auth, Storage, Deno, Caddy, Node (rarely changes)
#   /opt/dp/incoming/app-<id>.tar.gz        gateway, API functions, these scripts, their dependencies
#   /etc/dp/config.env                      DP_DOMAIN and optional LLM_* / SMTP_* settings
#
#   install.sh <platform-id> <app-id>
#
# Idempotent: every run brings the server to the same state. Secrets are generated once on the
# server (server/secrets-plan.ts) and never leave it; PostgreSQL and every service listen on
# 127.0.0.1 only; Caddy alone serves 80/443. Nothing is downloaded at run time except the
# distribution's PostgreSQL packages (apt) and the site's certificate (Let's Encrypt).
set -euo pipefail

PLATFORM_ID="${1:?platform id}"
APP_ID="${2:?app id}"
INCOMING=/opt/dp/incoming
OPT=/opt/dp
ETC=/etc/dp
SERVICES=(dp-auth dp-rest dp-storage dp-gateway dp-caddy)
TIMERS=(dp-dispatch.timer dp-housekeeping.timer dp-backup.timer)

log() { printf '\n== %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
. /etc/os-release
[ "${ID:-}" = ubuntu ] && [ "${VERSION_ID%%.*}" -ge 24 ] || die "Ubuntu 24.04 or newer is required (found ${PRETTY_NAME:-unknown})"
[ "$(uname -m)" = x86_64 ] || die "an x86_64 (amd64) server is required"
[ -f "$ETC/config.env" ] || die "$ETC/config.env is missing (the deploy writes it)"
[[ "$PLATFORM_ID" =~ ^[A-Za-z0-9._-]+$ && "$APP_ID" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad release ids"

log "packages"
export DEBIAN_FRONTEND=noninteractive
missing=()
for p in postgresql-16 postgresql-client-16 curl ca-certificates; do
  dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
done
if [ ${#missing[@]} -gt 0 ]; then
  apt-get update -q
  apt-get install -yq --no-install-recommends "${missing[@]}"
fi

log "users and directories"
id dp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/dp --no-create-home --shell /usr/sbin/nologin dp
id dpcaddy >/dev/null 2>&1 || useradd --system --home-dir /var/lib/dp/caddy --no-create-home --shell /usr/sbin/nologin dpcaddy
install -d -m 755 "$OPT" "$OPT/platform" "$OPT/app" "$OPT/web"
install -d -m 700 /var/backups/dp
# Traversable, not listable: Caddy (its own user) reads the Caddyfile; every other file is 0600.
install -d -m 711 "$ETC"
install -d -m 755 /var/lib/dp
install -d -m 750 -o dp -g dp /var/lib/dp/storage
install -d -m 700 -o dpcaddy -g dpcaddy /var/lib/dp/caddy

log "release platform $PLATFORM_ID, app $APP_ID"
unpack() {
  local kind="$1" id="$2" dest="$OPT/$1/$2"
  if [ ! -d "$dest" ]; then
    [ -f "$INCOMING/$kind-$id.tar.gz" ] || die "$INCOMING/$kind-$id.tar.gz was not uploaded"
    rm -rf "$dest.part"
    mkdir -p "$dest.part"
    tar -xzf "$INCOMING/$kind-$id.tar.gz" -C "$dest.part"
    chmod -R a+rX,go-w "$dest.part"
    mv "$dest.part" "$dest"
  fi
  ln -sfn "$dest" "$OPT/$kind/current.part"
  mv -T "$OPT/$kind/current.part" "$OPT/$kind/current"
}
unpack platform "$PLATFORM_ID"
unpack app "$APP_ID"
if [ ! -e "$OPT/web/current" ]; then
  # First install: a placeholder until the deploy publishes the site (moments later).
  install -d -m 755 "$OPT/web/placeholder/assets"
  printf '<!doctype html><meta charset="utf-8"><title>…</title><p>Сайт публикуется, обновите страницу через минуту.</p>\n' >"$OPT/web/placeholder/index.html"
  ln -sfn "$OPT/web/placeholder" "$OPT/web/current"
fi
PLATFORM="$OPT/platform/current"
APP="$OPT/app/current"

log "configuration"
# Generates missing secrets (names only are printed) and renders every service's settings.
DENO_DIR=/root/.cache/dp-deno "$PLATFORM/bin/deno" run --no-prompt --allow-read="$ETC" --allow-write="$ETC" "$APP/server/configure.ts" "$ETC"
chmod 600 "$ETC"/*.env
chmod 644 "$ETC/Caddyfile"
secret() { sed -n "s/^$1=//p" "$ETC/secrets.env"; }
DOMAIN="$(sed -n 's/^DP_DOMAIN=//p' "$ETC/config.env" | tr -d '"' | tr '[:upper:]' '[:lower:]')"

log "PostgreSQL"
PGCONF=/etc/postgresql/16/main/conf.d/dp.conf
want_conf="# Managed by deploy/server/install.sh
listen_addresses = 'localhost'
timezone = 'UTC'
max_connections = 200
shared_buffers = '256MB'
"
if [ "$(cat "$PGCONF" 2>/dev/null)" != "$want_conf" ]; then
  printf '%s' "$want_conf" >"$PGCONF"
  systemctl restart postgresql
fi
systemctl enable --now postgresql >/dev/null
for _ in $(seq 1 30); do runuser -u postgres -- pg_isready -q && break; sleep 1; done
psql_dp() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }
if [ "$(psql_dp -d postgres -tAc "select 1 from pg_database where datname = 'dp'")" != 1 ]; then
  psql_dp -d postgres -c "create database dp"
fi
psql_dp -d dp -c "alter database dp set timezone to 'UTC'"
# The roles, schemas and grants a Supabase database has before the project's migrations.
psql_dp -d dp -f "$APP/supabase/local/bootstrap.sql"
# Role passwords from secrets.env (base64url: safe inside a SQL literal), sent on stdin.
{
  printf "alter role postgres password '%s';\n" "$(secret DP_PG_PASSWORD)"
  printf "alter role authenticator password '%s';\n" "$(secret DP_AUTHENTICATOR_PASSWORD)"
  printf "alter role supabase_auth_admin password '%s';\n" "$(secret DP_AUTH_ADMIN_PASSWORD)"
  printf "alter role supabase_storage_admin password '%s';\n" "$(secret DP_STORAGE_ADMIN_PASSWORD)"
} | psql_dp -d dp

log "auth schema"
systemd-run --quiet --wait --pipe --collect -p User=dp -p EnvironmentFile="$ETC/auth.env" "$PLATFORM/bin/gotrue" migrate >/dev/null </dev/null
psql_dp -d dp -f "$APP/supabase/local/after-auth.sql"

log "services"
install -m 644 "$APP"/deploy/server/systemd/*.service "$APP"/deploy/server/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable "${SERVICES[@]}" "${TIMERS[@]}" >/dev/null 2>&1
systemctl restart dp-auth dp-rest dp-storage
wait_http() {
  local name="$1" url="$2"
  for _ in $(seq 1 90); do
    curl -fsS -m 3 -o /dev/null "$url" 2>/dev/null && { echo "$name: ok"; return 0; }
    sleep 1
  done
  journalctl -u "$name" -n 40 --no-pager >&2 || true
  die "$name did not start"
}
wait_http dp-auth http://127.0.0.1:54324/health
wait_http dp-rest http://127.0.0.1:54425/ready
# Storage creates its schema on first start; the project's migrations need it (buckets).
wait_http dp-storage http://127.0.0.1:54326/status
systemctl restart dp-gateway
wait_http dp-gateway http://127.0.0.1:54321/health
systemctl restart dp-caddy
systemctl start "${TIMERS[@]}"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

log "HTTPS"
insecure=()
if [ "$DOMAIN" = localhost ] || [[ "$DOMAIN" =~ ^[0-9.]+$ ]]; then insecure=(-k); fi
ok=""
for _ in $(seq 1 60); do
  if curl -fsS -m 5 "${insecure[@]}" --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null "https://$DOMAIN/health" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
if [ -n "$ok" ]; then
  echo "https://$DOMAIN: ok"
else
  echo "WARNING: https://$DOMAIN does not answer yet. A certificate needs the domain's DNS A record to point to this server and ports 80/443 open." >&2
  journalctl -u dp-caddy -n 30 --no-pager >&2 || true
fi

log "cleanup"
# Keep the current release and the one before it (rollback: point current back, restart).
for kind in platform app; do
  find "$OPT/$kind" -mindepth 1 -maxdepth 1 -type d ! -name '*.part' ! -path "$(readlink -f "$OPT/$kind/current")" -printf '%T@ %p\n' |
    sort -rn | cut -d' ' -f2- | tail -n +2 | while IFS= read -r old; do rm -rf "$old"; done
done
rm -f "$INCOMING"/platform-*.tar.gz "$INCOMING"/app-*.tar.gz
echo "installed: platform $PLATFORM_ID, app $APP_ID, https://$DOMAIN"
