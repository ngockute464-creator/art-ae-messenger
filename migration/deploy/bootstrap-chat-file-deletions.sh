#!/usr/bin/env bash
# Additive schema-only bootstrap for durable chat attachment removal.
# Run BEFORE switching the production API to the corresponding commit.
set -Eeuo pipefail
umask 077
[[ $(id -u) -eq 0 ]] || { echo '[cleanup] Root required' >&2; exit 1; }
[[ $# -eq 1 ]] || { echo '[cleanup] Pin an exact verified Git SHA' >&2; exit 1; }
SHA="$1"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo '[cleanup] Invalid Git SHA' >&2; exit 1; }
exec 9>/run/lock/artae-chat-cleanup-schema.lock
flock -n 9 || { echo '[cleanup] Migration already running' >&2; exit 1; }
systemctl is-active --quiet artae.service || exit 1
[[ -r /etc/artae/artae.env ]] || { echo '[cleanup] App configuration missing' >&2; exit 1; }
curl -fsS --max-time 5 http://127.0.0.1:3100/healthz | grep -q '"ok":true' || {
 echo '[cleanup] Production API is not healthy' >&2; exit 1;
}
SQL="$(mktemp)"
trap 'rm -f "$SQL"' EXIT
URL="https://raw.githubusercontent.com/ngockute464-creator/art-ae-messenger/$SHA/migration/sql/006_chat_file_deletions.sql"
curl --fail --silent --show-error --retry 2 --max-time 30 "$URL" -o "$SQL"
grep -q "VALUES('006_chat_file_deletions')" "$SQL" || {
 echo '[cleanup] Unexpected SQL content' >&2; exit 1;
}
[[ $(runuser -u postgres -- psql -X -At -v ON_ERROR_STOP=1 -d artae \
 -c 'SELECT current_database()') == artae ]] || exit 1
install -d -m 700 /var/backups/artae
BACKUP="/var/backups/artae/pre-chat-file-cleanup-$(date -u +%Y%m%dT%H%M%SZ).dump"
[[ ! -e "$BACKUP" ]] || exit 1
echo '[cleanup] Backing up local PostgreSQL before additive migration'
runuser -u postgres -- pg_dump -Fc -d artae > "$BACKUP"
[[ -s "$BACKUP" ]] && pg_restore -l "$BACKUP" >/dev/null || {
 echo '[cleanup] Backup verification failed' >&2; exit 1;
}
echo '[cleanup] Applying migration 006 (creates only queue table and index)'
# Root opens the mode-0600 temporary SQL; postgres receives only stdin.
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae < "$SQL"
STATUS=$(runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -At -d artae \
 -c "SELECT count(*) FROM public.artae_schema_migrations WHERE version='006_chat_file_deletions'")
[[ "$STATUS" == 1 ]] || { echo '[cleanup] Migration ledger verification failed' >&2; exit 1; }
echo "ARTAE_CHAT_CLEANUP_SCHEMA_OK migration=006 backup=$BACKUP files_unchanged=true"
