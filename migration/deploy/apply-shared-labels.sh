#!/usr/bin/env bash
# Add shared labels on production PostgreSQL safely, before deploying client/API.
# Run as root on Cloud4Box. Does not restart API or alter running application.
set -Eeuo pipefail
umask 077
EXPECTED_SHA="${1:-}"
[[ $(id -u) -eq 0 ]] || { echo 'Must run as root' >&2; exit 1; }
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Supply exact feature-branch SHA' >&2; exit 1; }
for c in git pg_dump psql flock runuser; do command -v "$c" >/dev/null || exit 1; done
install -d -m 700 /var/backups/artae
exec 9>/run/lock/artae-shared-labels.lock
flock -n 9 || { echo 'A shared labels migration is already running' >&2; exit 1; }
STAGE=$(mktemp -d /tmp/artae-labels.XXXXXXXX)
trap 'rm -rf -- "$STAGE"' EXIT
git clone -q --depth 1 --branch feature/office-native-readonly-preview \
 https://github.com/ngockute464-creator/art-ae-messenger.git "$STAGE/repo"
FOUND_SHA=$(git -C "$STAGE/repo" rev-parse HEAD)
[[ "$FOUND_SHA" == "$EXPECTED_SHA" ]] || { echo "Branch changed: $FOUND_SHA" >&2; exit 1; }
SQL="$STAGE/repo/migration/sql/007_shared_labels.sql"
[[ -s "$SQL" ]] || exit 1
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c 'SELECT current_database()' | grep -qx artae
BACKUP="/var/backups/artae/pre-shared-labels-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo "Saving local PostgreSQL backup: $BACKUP"
runuser -u postgres -- pg_dump --format=custom --dbname=artae > "$BACKUP"
[[ -s "$BACKUP" ]] || { echo 'Backup is empty' >&2; exit 1; }
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae < "$SQL"
runuser -u artae_app -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c 'SELECT count(*) FROM public.artae_labels' >/dev/null
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae -At \
 -c "SELECT count(*) FROM public.artae_schema_migrations WHERE version='007_shared_labels'" | grep -qx 1
echo 'ARTAE_SHARED_LABELS_SCHEMA_OK backup_preserved=true production_app_unchanged=true'
