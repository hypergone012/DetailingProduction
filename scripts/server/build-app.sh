#!/usr/bin/env bash
# Builds the server's app bundle: the gateway, the API functions, the install scripts and
# every Deno dependency (DENO_DIR), so the server runs with --cached-only and downloads nothing.
#
#   scripts/server/build-app.sh <out-dir>     -> <out-dir>/app-<id>.tar.gz
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$(mkdir -p "${1:?out dir}" && cd "$1" && pwd)"
DENO="$ROOT/node_modules/deno/deno"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"

(cd "$ROOT" && pnpm -s functions:vendor >/dev/null)
mkdir -p "$STAGE/server" "$STAGE/supabase/local" "$STAGE/deploy"
cp "$ROOT"/server/*.ts "$STAGE/server/"
rm -f "$STAGE"/server/*.test.ts
cp -r "$ROOT/supabase/functions" "$STAGE/supabase/functions"
cp "$ROOT"/supabase/local/*.sql "$STAGE/supabase/local/"
cp -r "$ROOT/deploy/server" "$STAGE/deploy/server"

# The id covers the code, not the dependency cache (its metadata carries timestamps).
ID="$(cd "$STAGE" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)"
echo "app-id=$ID"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "app-id=$ID" >>"$GITHUB_OUTPUT"

handlers=("$STAGE"/supabase/functions/*/handler.ts)
DENO_DIR="$STAGE/deno-dir" "$DENO" cache --quiet --config "$STAGE/supabase/functions/deno.json" "$STAGE/server/gateway.ts" "$STAGE/server/configure.ts" "${handlers[@]}"
echo "{\"id\":\"$ID\",\"commit\":\"$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)\"}" >"$STAGE/app.json"
tar -czf "$OUT/app-$ID.tar.gz" -C "$STAGE" .
ls -lh "$OUT/app-$ID.tar.gz"
