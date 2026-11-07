#!/usr/bin/env bash
# ART-AE: explicit, backed-up and idempotent Stage 1 schema migration.
# Does NOT change the current API, frontend, service, or GitHub branches.
set -Eeuo pipefail
umask 077
EXPECTED_SHA="$1"
REPO='https://github.com/ngockute464-creator/art-ae-messenger.git'
BRANCH='feature/message-counts-read'
[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply pinned git SHA' >&2; exit 1; }
command -v git >/dev/null
command -v pg_dump >/dev/null
command -v psql >/dev/null
install -d -m 700 /var/backups/artae
exec 9>/run/lock/artae-unread-schema.lock
flock -n 9 || { echo 'Another schema migration in progress' >&2; exit 1; }
STAGE=$(mktemp -d /tmp/artae-unread.XXXXXXXX)
trap 'rm -rf -- "$STAGE"' EXIT
git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$STAGE/repo"
FOUND_SHA=$(git -C "$STAGE/repo" rev-parse HEAD)
[[ "$FOUND_SHA" == "$EXPECTED_SHA" ]] || {
 echo "Feature branch changed: $FOUND_SHA (expected $EXPECTED_SHA)" >&2; exit 1;
}
[[ -s "$STAGE/repo/migration/sql/003_message_reads.sql" ]] || exit 1
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c "SELECT current_database()" | grep -qx 'artae'
BACKUP="/var/backups/artae/pre-unread-$(date -u +%Y%m%dT%H%M%SZ).dump"
[[ ! -e "$BACKUP" ]] || { echo 'Backup collision' >&2; exit 1; }
echo "Backing up local PostgreSQL to $BACKUP"
runuser -u postgres -- pg_dump --format=custom --dbname=artae > "$BACKUP"
[[ -s "$BACKUP" ]] || { echo 'Backup is empty' >&2; exit 1; }
echo 'Applying additive read-state schema'
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae \
 < "$STAGE/repo/migration/sql/003_message_reads.sql"
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c "SELECT count(*) FROM public.artae_schema_migrations WHERE version='003_message_reads'" \
 | grep -qx '1'
runuser -u artae_app -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c 'SELECT count(*) FROM public.artae_message_reads' >/dev/null
echo 'ARTAE_UNREAD_SCHEMA_OK backup_preserved=true frontend_unchanged=true api_unchanged=true'
