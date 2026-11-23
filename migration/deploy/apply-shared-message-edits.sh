#!/usr/bin/env bash
# ART-AE 009. One-time additive editor attribution migration. Production app is not restarted.
set -Eeuo pipefail
umask 077
EXPECTED_SHA="${1:-}"
[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply verified 40-char feature SHA' >&2; exit 1; }
for tool in git pg_dump psql flock runuser; do command -v "$tool" >/dev/null || exit 1; done
install -d -m 700 /var/backups/artae
exec 9>/run/lock/artae-shared-message-edits.lock
flock -n 9 || { echo 'Migration lock is busy' >&2; exit 1; }
STAGE=$(mktemp -d /tmp/artae-edit-migration.XXXXXXXX)
trap 'rm -rf -- "$STAGE"' EXIT
git clone -q --depth 1 --branch feature/office-native-readonly-preview \
 https://github.com/ngockute464-creator/art-ae-messenger.git "$STAGE/repo"
SHA=$(git -C "$STAGE/repo" rev-parse HEAD)
[[ "$SHA" == "$EXPECTED_SHA" ]] || { echo "Ref changed: $SHA" >&2; exit 1; }
SQL="$STAGE/repo/migration/sql/009_shared_message_edits.sql"
[[ -s "$SQL" ]] || exit 1
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c 'SELECT current_database()' | grep -qx artae
BACKUP="/var/backups/artae/pre-message-edit-rights-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo "Saving PostgreSQL backup: $BACKUP"
runuser -u postgres -- pg_dump --format=custom --dbname=artae > "$BACKUP"
[[ -s "$BACKUP" ]] || { echo 'Backup missing' >&2; exit 1; }
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae < "$SQL"
runuser -u artae_app -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c 'SELECT count(edited_by),count(edited_by_name) FROM public.artae_messages' >/dev/null
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c "SELECT count(*) FROM public.artae_schema_migrations WHERE version='009_shared_message_edits'" | grep -qx 1
echo "ARTAE_SHARED_MESSAGE_EDITS_OK backup_preserved=true running_app_unchanged=true"
