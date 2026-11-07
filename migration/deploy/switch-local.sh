#!/usr/bin/env bash
# ART-AE: deliberate production cutover from Supabase API to local PostgreSQL.
# Changes ONLY artae.service's API executable/user; leaves Caddy, DNS and frontend intact.
# On failure removes its own systemd drop-in and restarts the previous API.
set -Eeuo pipefail
umask 027

EXPECTED_SHA="${1:-}"
REPO='https://github.com/ngockute464-creator/art-ae-messenger.git'
BRANCH='migration/local-postgres'
NEXT='/opt/artae-next'
LIVE='/opt/artae/work'
UNIT='artae.service'
OVERRIDE='/etc/systemd/system/artae.service.d/90-artae-local-postgres.conf'
LOCK='/run/lock/artae-local-cutover.lock'
STAGE=''
CHANGED=0
SUCCESS=0

log(){ printf '[artae-cutover] %s\n' "$*"; }
fail(){ log "ERROR: $*" >&2; exit 1; }
cleanup(){
 local code=$?
 trap - EXIT INT TERM HUP
 if [[ "$CHANGED" -eq 1 && "$SUCCESS" -eq 0 ]]; then
   log 'New API failed: reverting systemd override to previous production API'
   rm -f "$OVERRIDE"
   systemctl daemon-reload || true
   systemctl restart "$UNIT" || true
   if systemctl is-active --quiet "$UNIT"; then log 'Previous API service restarted'; else log 'WARNING: previous API restart failed'; fi
   journalctl -u "$UNIT" -n 16 --no-pager 2>/dev/null || true
 fi
 [[ -z "$STAGE" ]] || rm -rf -- "$STAGE"
 exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

[[ $(id -u) -eq 0 ]] || fail 'Run as root'
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'Specify exact pinned migration commit SHA'
exec 9>"$LOCK"
flock -n 9 || fail 'Another cutover is running'
systemctl is-active --quiet "$UNIT" || fail 'Production service not active'
if systemctl is-active --quiet artae-auto.timer; then fail 'Auto-deployment timer is still active'; fi
[[ -s "$LIVE/public/index.html" ]] || fail 'Production frontend missing'
[[ -f /etc/artae/artae.env ]] || fail 'Existing production env file missing'
[[ -d "$NEXT/node_modules/pg" ]] || fail 'Local PostgreSQL pg driver missing'
[[ -x /usr/local/bin/node ]] || fail 'Node.js unavailable'
[[ ! -e "$OVERRIDE" ]] || fail 'Migration drop-in already exists; refusing to overwrite'
if ! grep -qE 'reverse_proxy +127[.]0[.]0[.]1:3100' /etc/caddy/Caddyfile; then
 fail 'Caddy is not pointing to expected production port 3100'
fi

log 'Preparing pinned migration runtime (production not yet changed)'
STAGE=$(mktemp -d "$NEXT/.cutover-stage.XXXXXX")
git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$STAGE"
FOUND_SHA=$(git -C "$STAGE" rev-parse HEAD)
[[ "$FOUND_SHA" == "$EXPECTED_SHA" ]] || fail "Migration branch moved: $FOUND_SHA (expected $EXPECTED_SHA)"
install -d -m 750 -o artae_app -g artae_app "$NEXT/runtime"
for src in "$STAGE"/migration/runtime/*.mjs; do
 install -m 640 -o artae_app -g artae_app "$src" "$NEXT/runtime/$(basename "$src")"
done
for src in "$NEXT"/runtime/*.mjs; do
 /usr/local/bin/node --check "$src" >/dev/null
done
runuser -u artae_app -- /usr/local/bin/node --input-type=module -e \
  "import {assertLocalDatabase,closePool} from '$NEXT/runtime/postgres.mjs'; await assertLocalDatabase(); await closePool();"
log 'New API syntax and local DB connection verified'
log 'Switching artae.service to local PostgreSQL (Caddy and frontend unchanged)'
install -d -m 755 /etc/systemd/system/artae.service.d
cat > "$OVERRIDE" <<'UNITFILE'
[Service]
User=artae_app
Group=artae_app
WorkingDirectory=/opt/artae-next
ExecStart=
ExecStart=/usr/local/bin/node /opt/artae-next/runtime/http-server.mjs
EnvironmentFile=/etc/artae/artae.env
Environment=ARTAE_API_PORT=3100
Environment=ARTAE_PUBLIC_ORIGIN=https://artae.duckdns.org
Environment=ARTAE_NEXT_ALLOW_DISK_WRITES=1
UNITFILE
CHANGED=1
systemctl daemon-reload
systemctl restart "$UNIT"
healthy=0
for try in 1 2 3 4 5 6 7 8 9 10; do
 if curl --fail --silent --max-time 3 http://127.0.0.1:3100/healthz | grep -q '"ok":true' &&
    curl --fail --silent --max-time 3 'http://127.0.0.1:3100/.netlify/functions/auth?action=status' | grep -q '"initialized":true'; then
   healthy=1
   break
 fi
 sleep 1
done
[[ "$healthy" -eq 1 ]] || fail 'New production API did not pass health/status checks'
SUCCESS=1
log 'CUTOVER_OK local_postgres=true port=3100 frontend=unchanged caddy=unchanged auto_timer=inactive'
log 'Rollback: rm -f /etc/systemd/system/artae.service.d/90-artae-local-postgres.conf; systemctl daemon-reload; systemctl restart artae.service'
