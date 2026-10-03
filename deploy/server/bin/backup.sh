#!/usr/bin/env bash
# dp-backup.service (daily): a consistent database dump and the uploaded files, kept for
# DP_BACKUP_KEEP_DAYS days (default 7) in /var/backups/dp. The server's secrets are copied
# once next to them: a restored database needs them (booking links, push, sign-in).
# Restore: deploy/server/RESTORE.md. Copy this folder off the server regularly.
set -euo pipefail
DIR=/var/backups/dp
KEEP_DAYS="${DP_BACKUP_KEEP_DAYS:-7}"
umask 077
mkdir -p "$DIR"
ts="$(date -u +%Y%m%d-%H%M%S)"
runuser -u postgres -- pg_dump -Fc -d dp >"$DIR/db-$ts.dump.part"
mv "$DIR/db-$ts.dump.part" "$DIR/db-$ts.dump"
tar -C /var/lib/dp -czf "$DIR/files-$ts.tar.gz.part" storage
mv "$DIR/files-$ts.tar.gz.part" "$DIR/files-$ts.tar.gz"
cmp -s /etc/dp/secrets.env "$DIR/secrets.env" 2>/dev/null || cp /etc/dp/secrets.env "$DIR/secrets.env"
find "$DIR" -maxdepth 1 \( -name 'db-*.dump' -o -name 'files-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
find "$DIR" -maxdepth 1 -name '*.part' -mmin +600 -delete
echo "backup $ts: $(du -sh "$DIR/db-$ts.dump" | cut -f1) database, $(du -sh "$DIR/files-$ts.tar.gz" | cut -f1) files"
