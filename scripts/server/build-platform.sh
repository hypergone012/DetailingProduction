#!/usr/bin/env bash
# Builds the server's platform bundle: Supabase Auth, PostgREST, Supabase Storage (+ Node 24),
# Deno and Caddy at the versions pinned in deploy/server/versions.env — the same components the
# local stack and the tests run. Linux x86_64; needs git, curl, go, npm.
#
#   scripts/server/build-platform.sh <out-dir>     -> <out-dir>/platform-<id>.tar.gz
#
# The id is a hash of the pinned versions and this script: an unchanged platform is neither
# rebuilt (CI cache) nor uploaded again (the server keeps it).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$(mkdir -p "${1:?out dir}" && cd "$1" && pwd)"
. "$ROOT/deploy/server/versions.env"
DENO_VERSION="$(node -p "require('$ROOT/node_modules/deno/package.json').version")"
ID="$( (cat "$ROOT/deploy/server/versions.env" "$0"; echo "deno $DENO_VERSION") | sha256sum | cut -c1-12)"
echo "platform-id=$ID"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "platform-id=$ID" >>"$GITHUB_OUTPUT"
if [ -f "$OUT/platform-$ID.tar.gz" ]; then echo "platform-$ID.tar.gz exists"; exit 0; fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"
mkdir -p "$STAGE/bin"

echo "== Supabase Auth $AUTH_COMMIT"
git clone -q --filter=blob:none https://github.com/supabase/auth "$WORK/auth"
git -C "$WORK/auth" checkout -q "$AUTH_COMMIT"
(cd "$WORK/auth" && CGO_ENABLED=0 GOTOOLCHAIN=auto go build -trimpath -ldflags "-s -w" -o "$STAGE/bin/gotrue" .)
cp -r "$WORK/auth/migrations" "$STAGE/auth-migrations"

echo "== PostgREST $POSTGREST_VERSION"
curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x86-64.tar.xz" | tar -xJ -C "$STAGE/bin"

echo "== Caddy $CADDY_VERSION"
base="https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION"
curl -fsSL -o "$WORK/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" "$base/caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
curl -fsSL -o "$WORK/caddy_checksums.txt" "$base/caddy_${CADDY_VERSION}_checksums.txt"
(cd "$WORK" && grep " caddy_${CADDY_VERSION}_linux_amd64.tar.gz\$" caddy_checksums.txt | sha512sum -c --quiet)
mkdir -p "$WORK/caddy" && tar -xzf "$WORK/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" -C "$WORK/caddy" caddy
cp "$WORK/caddy/caddy" "$STAGE/bin/caddy"

echo "== Deno $DENO_VERSION (the binary the tests run)"
cp "$ROOT/node_modules/deno/deno" "$STAGE/bin/deno"
"$STAGE/bin/deno" --version | head -1

echo "== Node $NODE24_VERSION"
(cd "$WORK" && npm pack -q "node-linux-x64@$NODE24_VERSION" >/dev/null && tar -xzf node-linux-x64-*.tgz && mv package "$STAGE/node")
"$STAGE/node/bin/node" --version

echo "== Supabase Storage $STORAGE_COMMIT"
git clone -q --filter=blob:none https://github.com/supabase/storage "$WORK/storage"
git -C "$WORK/storage" checkout -q "$STORAGE_COMMIT"
(
  cd "$WORK/storage"
  export PATH="$STAGE/node/bin:$PATH"
  npx -y npm@11.21.0 ci --no-audit --no-fund >/dev/null
  node ./build.js
  npx resolve-tspaths >/dev/null
  npx -y npm@11.21.0 prune --omit=dev --no-audit --no-fund >/dev/null
)
mkdir -p "$STAGE/storage"
cp -r "$WORK/storage/dist" "$WORK/storage/node_modules" "$WORK/storage/migrations" "$WORK/storage/package.json" "$STAGE/storage/"
[ -d "$WORK/storage/static" ] && cp -r "$WORK/storage/static" "$STAGE/storage/"
find "$STAGE/storage/dist" \( -name '*.map' -o -name '*.test.js' \) -delete

echo "{\"id\":\"$ID\",\"auth\":\"$AUTH_COMMIT\",\"storage\":\"$STORAGE_COMMIT\",\"postgrest\":\"$POSTGREST_VERSION\",\"caddy\":\"$CADDY_VERSION\",\"deno\":\"$DENO_VERSION\",\"node\":\"$NODE24_VERSION\"}" >"$STAGE/platform.json"
tar -czf "$OUT/platform-$ID.tar.gz.part" -C "$STAGE" .
mv "$OUT/platform-$ID.tar.gz.part" "$OUT/platform-$ID.tar.gz"
ls -lh "$OUT/platform-$ID.tar.gz"
