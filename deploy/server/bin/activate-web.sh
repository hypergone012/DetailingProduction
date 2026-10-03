#!/usr/bin/env bash
# Publishes a build of the web app: activate-web.sh <web-tarball> <build-id>.
# The switch is atomic (a symlink) and needs no restart. Scripts and styles of the previous
# build stay available, so a page opened before the deploy can still load its lazy parts;
# older builds are removed.
set -euo pipefail
TAR="$1"
ID="$2"
WEB=/opt/dp/web
[[ "$ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad build id" >&2; exit 2; }
NEW="$WEB/$ID"
rm -rf "$NEW.part"
mkdir -p "$NEW.part"
tar -xzf "$TAR" -C "$NEW.part"
[ -f "$NEW.part/index.html" ] || { echo "not a web build: no index.html" >&2; exit 1; }
(cd "$NEW.part/assets" && ls -1) >"$NEW.part/.build-assets"
if [ -f "$WEB/current/.build-assets" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && [ ! -e "$NEW.part/assets/$f" ] && [ -f "$WEB/current/assets/$f" ] && cp -p "$WEB/current/assets/$f" "$NEW.part/assets/$f"
  done <"$WEB/current/.build-assets"
fi
chmod -R a+rX "$NEW.part"
rm -rf "$NEW"
mv "$NEW.part" "$NEW"
ln -sfn "$NEW" "$WEB/current.part"
mv -T "$WEB/current.part" "$WEB/current"
# Keep this build and the two before it.
find "$WEB" -mindepth 1 -maxdepth 1 -type d ! -name '*.part' ! -path "$NEW" -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2- | tail -n +3 |
  while IFS= read -r old; do rm -rf "$old"; done
echo "web $ID active"
