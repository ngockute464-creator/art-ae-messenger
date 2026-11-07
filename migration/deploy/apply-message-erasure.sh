#!/usr/bin/env bash
# One-time irreversible live-message erasure after verified deployment.
set -Eeuo pipefail
umask 077
trap 'rc=$?; echo "[erase] ERROR line $LINENO exit=$rc" >&2' ERR
[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
EXPECTED="$1"
[[ "$EXPECTED" =~ ^[a-f0-9]{40}$ ]] || { echo 'Pass pinned SHA' >&2; exit 1; }
exec 9>/run/lock/artae-message-erase.lock
flock -n 9 || { echo 'Message erasure in progress' >&2; exit 1; }
LIVE=/opt/artae/work
[[ -r "$LIVE/.release-commit" ]] || exit 1
CURRENT=$(cat "$LIVE/.release-commit")
[[ "$CURRENT" == "$EXPECTED" ]] || {
 echo "[erase] Deployed release is $CURRENT, expected $EXPECTED" >&2; exit 1;
}
[[ -s "$LIVE/migration/sql/005_erase_deleted_text.sql" ]] || exit 1
systemctl is-active --quiet artae.service || exit 1
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3100/healthz | grep -q '"ok":true' || exit 1
grep -Fq "SET body=\\'\\',deleted_at=" /opt/artae-next/runtime/sync.mjs || {
 echo '[erase] New erase-on-delete API not deployed, refusing migration' >&2; exit 1;
}
echo '[erase] Backing up local DB; old deleted text remains in this backup'
install -d -m 700 /var/backups/artae
BACKUP="/var/backups/artae/pre-message-erasure-$(date -u +%Y%m%dT%H%M%SZ).dump"
[[ ! -e "$BACKUP" ]] || exit 1
runuser -u postgres -- pg_dump -Fc -d artae > "$BACKUP"
[[ -s "$BACKUP" ]] || exit 1
echo '[erase] Scrubbing previously deleted bodies'
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae \
 < "$LIVE/migration/sql/005_erase_deleted_text.sql"
CHECK=$(runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -At -d artae \
 -c "SELECT count(*) FROM public.artae_messages WHERE deleted_at IS NOT NULL AND body<>''")
[[ "$CHECK" == 0 ]] || { echo "[erase] Deleted bodies remaining: $CHECK" >&2; exit 1; }
echo "ARTAE_MESSAGE_ERASURE_OK schema=005 deleted_bodies=0 backup=$BACKUP files_unchanged=true"
