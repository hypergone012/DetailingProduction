#!/usr/bin/env bash
# Deploys the whole platform to one server over SSH (the "Deploy server" workflow runs it; it
# also runs from any Linux machine with the repository's dependencies installed):
#
#   1. platform + app bundles (scripts/server/build-*.sh) -> the server; deploy/server/install.sh
#   2. through an SSH tunnel: database migrations, (once) the move from Supabase, studios
#   3. the web app built for https://$DP_DOMAIN, with every studio's shell -> activate-web.sh
#   4. checks: every studio page and API through the public address
#
# Env (secrets are never printed; in GitHub Actions they are masked as well):
#   DP_SSH_HOST, DP_SSH_USER (root), DP_SSH_PORT (22), DP_SSH_KEY (private key) or DP_SSH_PASSWORD,
#   DP_SSH_KNOWN_HOSTS (optional: the server's host key line; otherwise trusted on first use)
#   DP_DOMAIN, DP_ACME_EMAIL, LLM_API_KEY / LLM_MODEL / LLM_BASE_URL, SMTP_* (optional)
#   TENANT_DEMO_OWNER_PASSWORD (demo cabinets)
#   DP_MIGRATE_FROM_SUPABASE=1 with SOURCE_DATABASE_URL, SOURCE_SUPABASE_URL, SOURCE_SERVICE_ROLE_KEY
#   DP_RELEASE_DIR (where the bundles are built; default .local/release)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

: "${DP_SSH_HOST:?DP_SSH_HOST}" "${DP_DOMAIN:?DP_DOMAIN}"
DP_SSH_USER="${DP_SSH_USER:-root}"
DP_SSH_PORT="${DP_SSH_PORT:-22}"
DP_DOMAIN="$(printf '%s' "$DP_DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')"
APP_URL="https://$DP_DOMAIN"
REL="${DP_RELEASE_DIR:-$ROOT/.local/release}"
mkdir -p "$REL"

step() { printf '\n==== %s\n' "$*"; }
mask() { [ -n "${GITHUB_ACTIONS:-}" ] && [ -n "$1" ] && echo "::add-mask::$1"; return 0; }

# ---------------------------------------------------------------- SSH
SSHDIR="$(mktemp -d)"
TUNNEL_PID=""
cleanup() {
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  ssh -S "$SSHDIR/ctl" -O exit "$DP_SSH_USER@$DP_SSH_HOST" >/dev/null 2>&1 || true
  rm -rf "$SSHDIR"
}
trap cleanup EXIT
SSH_OPTS=(-p "$DP_SSH_PORT" -o UserKnownHostsFile="$SSHDIR/known_hosts" -o ServerAliveInterval=15 -o ConnectTimeout=20
  -o ControlMaster=auto -o ControlPath="$SSHDIR/ctl" -o ControlPersist=15m -o LogLevel=ERROR)
if [ -n "${DP_SSH_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$DP_SSH_KNOWN_HOSTS" >"$SSHDIR/known_hosts"
  SSH_OPTS+=(-o StrictHostKeyChecking=yes)
else
  SSH_OPTS+=(-o StrictHostKeyChecking=accept-new)
fi
SSH=(ssh)
if [ -n "${DP_SSH_KEY:-}" ]; then
  printf '%s\n' "$DP_SSH_KEY" | tr -d '\r' >"$SSHDIR/key"
  chmod 600 "$SSHDIR/key"
  SSH_OPTS+=(-i "$SSHDIR/key" -o IdentitiesOnly=yes -o BatchMode=yes)
elif [ -n "${DP_SSH_PASSWORD:-}" ]; then
  command -v sshpass >/dev/null || { echo "sshpass is required for password login (apt-get install sshpass)" >&2; exit 1; }
  export SSHPASS="$DP_SSH_PASSWORD"
  SSH=(sshpass -e ssh)
  SSH_OPTS+=(-o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no)
fi
TARGET="$DP_SSH_USER@$DP_SSH_HOST"
SUDO=""
[ "$DP_SSH_USER" = root ] || SUDO="sudo -n"
# remote <script>: runs a bash script on the server as root.
remote() { "${SSH[@]}" "${SSH_OPTS[@]}" "$TARGET" "$SUDO bash -euo pipefail -s" <<<"$1"; }
# upload <local file> <remote path> [mode]
upload() { "${SSH[@]}" "${SSH_OPTS[@]}" "$TARGET" "$SUDO install -D -m ${3:-600} /dev/stdin '$2'" <"$1"; }

step "сервер $DP_SSH_HOST"
"${SSH[@]}" "${SSH_OPTS[@]}" "$TARGET" "$SUDO true" || { echo "нет входа по SSH (адрес, пользователь, ключ или пароль; для не-root нужен sudo без пароля)" >&2; exit 1; }
ssh-keygen -lf "$SSHDIR/known_hosts" 2>/dev/null | sed 's/^/ключ сервера: /' | head -3 || true

# ---------------------------------------------------------------- 1. bundles + install
step "сборка серверных пакетов"
PLATFORM_ID="$(bash scripts/server/build-platform.sh "$REL" | tee /dev/stderr | sed -n 's/^platform-id=//p')"
APP_ID="$(bash scripts/server/build-app.sh "$REL" | tee /dev/stderr | sed -n 's/^app-id=//p')"
echo "platform $PLATFORM_ID, app $APP_ID"

step "загрузка на сервер"
if remote "test -d /opt/dp/platform/$PLATFORM_ID" 2>/dev/null; then
  echo "платформа $PLATFORM_ID уже на сервере"
else
  upload "$REL/platform-$PLATFORM_ID.tar.gz" "/opt/dp/incoming/platform-$PLATFORM_ID.tar.gz" 644
fi
upload "$REL/app-$APP_ID.tar.gz" "/opt/dp/incoming/app-$APP_ID.tar.gz" 644
upload deploy/server/install.sh /opt/dp/incoming/install.sh 700

CONFIG="$SSHDIR/config.env"
(
  umask 077
  echo "DP_DOMAIN=$DP_DOMAIN"
  for k in DP_ACME_EMAIL LLM_API_KEY LLM_MODEL LLM_BASE_URL SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER SMTP_SENDER_NAME; do
    v="${!k:-}"
    [ -z "$v" ] && continue
    case "$v" in *$'\n'* | *$'\r'*) echo "$k: многострочное значение не поддерживается" >&2; exit 1 ;; esac
    echo "$k=$v"
  done
) >"$CONFIG"
upload "$CONFIG" /etc/dp/config.env 600

step "установка"
remote "bash /opt/dp/incoming/install.sh '$PLATFORM_ID' '$APP_ID'"

# ---------------------------------------------------------------- 2. tunnel: database + studios
step "туннель к базе и API сервера"
PG_PORT=15432
API_PORT=15421
"${SSH[@]}" "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -N \
  -L "127.0.0.1:$PG_PORT:127.0.0.1:5432" -L "127.0.0.1:$API_PORT:127.0.0.1:54321" "$TARGET" &
TUNNEL_PID=$!
for _ in $(seq 1 30); do curl -fsS -m 2 -o /dev/null "http://127.0.0.1:$API_PORT/health" 2>/dev/null && break; sleep 1; done
curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$API_PORT/health"
secret() { remote "sed -n 's/^$1=//p' /etc/dp/secrets.env"; }
PG_PASSWORD="$(secret DP_PG_PASSWORD)"; mask "$PG_PASSWORD"
SERVICE_KEY="$(secret DP_SERVICE_ROLE_KEY)"; mask "$SERVICE_KEY"
ANON_KEY="$(secret DP_ANON_KEY)"
[ -n "$PG_PASSWORD" ] && [ -n "$SERVICE_KEY" ] && [ -n "$ANON_KEY" ] || { echo "на сервере нет /etc/dp/secrets.env" >&2; exit 1; }
export DATABASE_URL="postgres://postgres:$PG_PASSWORD@127.0.0.1:$PG_PORT/dp"
export SUPABASE_URL="http://127.0.0.1:$API_PORT"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
export SUPABASE_ANON_KEY="$ANON_KEY"
export APP_URL

step "база — миграции"
pnpm -s db:migrate

if [ "${DP_MIGRATE_FROM_SUPABASE:-}" = 1 ]; then
  step "перенос из Supabase"
  pnpm -s exec tsx scripts/server/migrate-from-supabase.ts --secrets-out="$SSHDIR/moved.env"
  if [ -s "$SSHDIR/moved.env" ]; then
    # The hosted project's secrets replace the generated ones: old booking links and push
    # subscriptions keep working. Names only are printed.
    upload "$SSHDIR/moved.env" /etc/dp/moved.env 600
    remote '
      cd /etc/dp
      while IFS= read -r line; do
        k="${line%%=*}"; [ -n "$k" ] || continue
        grep -v "^$k=" secrets.env >secrets.env.part || true
        printf "%s\n" "$line" >>secrets.env.part
        mv secrets.env.part secrets.env
        echo "секрет перенесён: $k"
      done <moved.env
      rm -f moved.env; chmod 600 secrets.env
      DENO_DIR=/root/.cache/dp-deno /opt/dp/platform/current/bin/deno run --no-prompt --allow-read=/etc/dp --allow-write=/etc/dp /opt/dp/app/current/server/configure.ts /etc/dp
      chmod 600 /etc/dp/*.env; chmod 644 /etc/dp/Caddyfile
      systemctl restart dp-gateway'
    for _ in $(seq 1 30); do curl -fsS -m 2 -o /dev/null "http://127.0.0.1:$API_PORT/health" 2>/dev/null && break; sleep 1; done
  fi
fi

step "студии — публикация"
pnpm -s tenant:publish --all --reset-demo-password

# ---------------------------------------------------------------- 3. web app
step "сайт — сборка для $APP_URL"
VITE_SUPABASE_URL="$APP_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" pnpm -s build
pnpm -s tenant:shells
rm -f apps/web/dist/_redirects
pnpm -s security:scan-bundle
WEB_ID="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo build)"
tar -czf "$REL/web-$WEB_ID.tar.gz" -C apps/web/dist .
upload "$REL/web-$WEB_ID.tar.gz" "/opt/dp/incoming/web-$WEB_ID.tar.gz" 644
remote "bash /opt/dp/app/current/deploy/server/bin/activate-web.sh /opt/dp/incoming/web-$WEB_ID.tar.gz '$WEB_ID' && rm -f /opt/dp/incoming/web-$WEB_ID.tar.gz"

# ---------------------------------------------------------------- 4. checks
step "проверка $APP_URL"
if [ "$DP_DOMAIN" = localhost ] || [[ "$DP_DOMAIN" =~ ^[0-9.]+$ ]]; then
  # No public certificate for localhost or a bare IP: trust the server's own CA for the checks.
  remote "cat /var/lib/dp/caddy/caddy/pki/authorities/local/root.crt" >"$SSHDIR/site-ca.crt"
  export NODE_EXTRA_CA_CERTS="$SSHDIR/site-ca.crt"
fi
ok=""
for i in 1 2 3 4 5 6; do
  if pnpm -s tenant:verify --all --app-url="$APP_URL"; then ok=1; break; fi
  echo "повтор через 20 с (сертификат или DNS ещё не готовы?)"; sleep 20
done
[ -n "$ok" ] || { echo "сайт не прошёл проверку: $APP_URL" >&2; exit 1; }
echo "готово: $APP_URL"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Сервер обновлён\n\nСайт: %s\n\nPlatform `%s`, app `%s`, web `%s`\n' "$APP_URL" "$PLATFORM_ID" "$APP_ID" "$WEB_ID" >>"$GITHUB_STEP_SUMMARY"
exit 0
