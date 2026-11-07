#!/usr/bin/env bash
# ART-AE: publish frontend and local PostgreSQL API as one release.
set -Eeuo pipefail
umask 027
BASE=/opt/artae
RELEASES="$BASE/releases"
LIVE="$BASE/work"
NEXT=/opt/artae-next
RUNTIMES="$NEXT/runtimes"
RUNTIME="$NEXT/runtime"
REPO=https://github.com/ngockute464-creator/art-ae-messenger.git
BRANCH=netlify-preview
NODE=/usr/local/bin/node
ACTION=''
if [[ $# -gt 0 ]]; then ACTION="$1"; fi
log(){ printf '[artae-deploy] %s\n' "$*"; }
fail(){ log "ERROR: $*" >&2; exit 1; }
[[ $(id -u) -eq 0 ]] || fail 'Run as root'
[[ "$ACTION" =~ ^(stage|promote|rollback|status)$ ]] || fail 'Usage: artae-release.sh {stage|promote|rollback|status} [release-id]'
[[ -x "$NODE" && -d "$NEXT/node_modules/pg" ]] || fail 'Local Node/PostgreSQL dependencies missing'
mkdir -p "$RELEASES" "$RUNTIMES"
chmod 755 "$RELEASES" "$RUNTIMES"
exec 9>/run/lock/artae-deploy.lock
flock -n 9 || fail 'Another deployment is running'

assert_local(){
 local override=/etc/systemd/system/artae.service.d/90-artae-local-postgres.conf
 [[ -r "$override" ]] || fail 'Local API override missing'
 grep -qF '/opt/artae-next/runtime/http-server.mjs' "$override" || fail 'Unexpected API entrypoint'
 grep -qF 'ARTAE_API_PORT=3100' "$override" || fail 'Unexpected API port'
}

health(){
 local v path
 v=$(curl -fsS --max-time 5 'http://127.0.0.1:3100/healthz') || return 1
 [[ "$v" == *'"ok":true'* ]] || return 1
 v=$(curl -fsS --max-time 5 'http://127.0.0.1:3100/.netlify/functions/auth?action=status') || return 1
 [[ "$v" == *'"initialized":true'* ]] || return 1
 for path in / /office/quire/ /office/ledger/ /office/artae-bridge.js; do
   curl -fsS --max-time 8 -o /dev/null \
     --resolve 'artae.duckdns.org:443:127.0.0.1' "https://artae.duckdns.org$path" || return 1
 done
}
wait_healthy(){
 local i
 for i in 1 2 3 4 5 6 7 8 9 10; do
   if health; then return 0; fi
   sleep 2
 done
 return 1
}
stage(){
 [[ -f /etc/artae/artae.env ]] || fail 'Missing production environment'
 local sha stamp id dir f
 sha=$(git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -f1)
 [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid production SHA'
 stamp=$(date -u +%Y%m%dT%H%M%SZ)
 id="$stamp-$(printf '%s' "$sha" | cut -c1-12)"
 dir="$RELEASES/$id"
 log "Preparing commit $sha without changing the running app"
 git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$dir"
 [[ $(git -C "$dir" rev-parse HEAD) == "$sha" ]] || fail 'Branch changed during checkout'
 [[ -s "$dir/migration/runtime/http-server.mjs" ]] || fail 'Missing local PostgreSQL API'
 [[ -s "$dir/migration/runtime/postgres.mjs" ]] || fail 'Missing local PostgreSQL driver'
 if grep -nE 'SUPABASE_URL|SUPABASE_SECRET_KEY|/rest/v1/' "$dir"/migration/runtime/*.mjs; then
   fail 'Runtime still uses Supabase REST'
 fi
 chown -R artae:artae "$dir"
 runuser -u artae -- bash -c 'cd "$1" && unzip -oq artae.zip -d . && "$2" build/prepare.mjs' -- "$dir" "$NODE"
 "$NODE" --check "$dir/public/app.js"
 for f in "$dir"/migration/runtime/*.mjs; do "$NODE" --check "$f"; done
 for f in "$dir"/netlify/functions/{auth,sync,pins,files-explorer,realtime-token,voice,voice-transcript}.mjs; do "$NODE" --check "$f"; done
 for f in public/index.html public/sw.js public/office/quire/index.html public/office/ledger/index.html public/office/artae-bridge.js; do
   [[ -s "$dir/$f" ]] || fail "Missing static asset: $f"
 done
 printf '%s\n' "$sha" > "$dir/.release-commit"
 chown -R artae:artae "$dir"
 chmod -R go-w "$dir"
 chmod 755 "$dir"
 # Caddy is not in the artae group: only PUBLIC assets must be world readable.
 find "$dir/public" -type d -exec chmod 755 {} +
 find "$dir/public" -type f -exec chmod 644 {} +
 log "STAGED=$id"
 log 'Production has not changed.'
}
resolve_release(){
 local id="$1"
 [[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$ ]] || fail 'Invalid release ID'
 [[ -s "$RELEASES/$id/.release-commit" && -s "$RELEASES/$id/migration/runtime/http-server.mjs" ]] || fail 'Release missing'
 printf '%s' "$RELEASES/$id"
}
swap_link(){
 local link="$1" target="$2" temp
 temp="$link.next.$$"
 [[ ! -e "$temp" && ! -L "$temp" ]] || fail 'Temporary link collision'
 ln -s "$target" "$temp"
 mv -Tf "$temp" "$link"
}
prepare_api(){
 local id="$1" source="$2" dest f
 dest="$RUNTIMES/$id"
 [[ ! -e "$dest" ]] || fail 'API version already staged'
 install -d -m 750 -o artae_app -g artae_app "$dest"
 for f in "$source"/migration/runtime/*.mjs; do
   install -m 640 -o artae_app -g artae_app "$f" "$dest/$(basename "$f")"
 done
 runuser -u artae_app -- "$NODE" --input-type=module -e \
   "import {assertLocalDatabase,closePool} from '$dest/postgres.mjs'; await assertLocalDatabase(); await closePool();"
 printf '%s' "$dest"
}
PREVIOUS_UI=''
PREVIOUS_API=''
SWITCH_STARTED=0
SWITCH_OK=0
recover(){
 local code=$?
 trap - EXIT HUP INT TERM
 if [[ "$SWITCH_STARTED" -eq 1 && "$SWITCH_OK" -eq 0 ]]; then
   log 'Deployment failed; restoring previous frontend and API'
   if [[ -d "$PREVIOUS_UI" ]]; then swap_link "$LIVE" "$PREVIOUS_UI" || true; fi
   if [[ -d "$PREVIOUS_API" && ( -L "$RUNTIME" || ! -e "$RUNTIME" ) ]]; then
     swap_link "$RUNTIME" "$PREVIOUS_API" || true
   fi
   systemctl restart artae.service || true
 fi
 exit "$code"
}
promote(){
 [[ $# -eq 1 ]] || fail 'Usage: promote RELEASE_ID'
 assert_local
 [[ -L "$LIVE" ]] || fail 'Frontend must be symlink'
 systemctl is-active --quiet artae.service || fail 'Production API inactive'
 systemctl is-active --quiet caddy.service || fail 'Caddy inactive'
 health || fail 'Existing production unhealthy'
 local id="$1" new_ui new_api
 new_ui=$(resolve_release "$id")
 PREVIOUS_UI=$(readlink -f "$LIVE")
 [[ "$new_ui" != "$PREVIOUS_UI" ]] || fail 'Release already active'
 new_api=$(prepare_api "$id" "$new_ui")
 if [[ -L "$RUNTIME" ]]; then
   PREVIOUS_API=$(readlink -f "$RUNTIME")
 elif [[ -d "$RUNTIME" ]]; then
   PREVIOUS_API="$RUNTIMES/legacy-$(date -u +%Y%m%dT%H%M%SZ)"
   [[ ! -e "$PREVIOUS_API" ]] || fail 'Legacy snapshot collision'
 else
   fail 'Existing local PostgreSQL API missing'
 fi
 SWITCH_STARTED=1
 trap recover EXIT HUP INT TERM
 if [[ ! -L "$RUNTIME" ]]; then mv "$RUNTIME" "$PREVIOUS_API"; fi
 swap_link "$RUNTIME" "$new_api"
 swap_link "$LIVE" "$new_ui"
 systemctl restart artae.service
 wait_healthy || fail 'New API or Office routes unhealthy'
 printf '%s\n' "$PREVIOUS_UI" > "$BASE/.previous-release"
 printf '%s\n' "$PREVIOUS_API" > "$NEXT/.previous-runtime"
 SWITCH_OK=1
 trap - EXIT HUP INT TERM
 log "DEPLOYED=$new_ui"
 log "API=$new_api"
}
rollback(){
 assert_local
 [[ -L "$LIVE" && -L "$RUNTIME" ]] || fail 'No managed frontend/API links'
 [[ -r "$BASE/.previous-release" && -r "$NEXT/.previous-runtime" ]] || fail 'No rollback pair recorded'
 local previous_ui previous_api current_ui current_api
 previous_ui=$(cat "$BASE/.previous-release")
 previous_api=$(cat "$NEXT/.previous-runtime")
 [[ "$previous_ui" == "$RELEASES/"* && -d "$previous_ui" ]] || fail 'Invalid previous frontend'
 [[ "$previous_api" == "$RUNTIMES/"* && -d "$previous_api" ]] || fail 'Invalid previous API'
 current_ui=$(readlink -f "$LIVE")
 current_api=$(readlink -f "$RUNTIME")
 swap_link "$RUNTIME" "$previous_api"
 swap_link "$LIVE" "$previous_ui"
 if ! systemctl restart artae.service || ! wait_healthy; then
   swap_link "$RUNTIME" "$current_api"
   swap_link "$LIVE" "$current_ui"
   systemctl restart artae.service || true
   fail 'Rollback failed; current release restored'
 fi
 printf '%s\n' "$current_ui" > "$BASE/.previous-release"
 printf '%s\n' "$current_api" > "$NEXT/.previous-runtime"
 log "ROLLED_BACK_TO_UI=$previous_ui"
 log "ROLLED_BACK_TO_API=$previous_api"
}
case "$ACTION" in
 stage) stage;;
 promote) [[ $# -eq 2 ]] || fail 'Expected release ID'; promote "$2";;
 rollback) rollback;;
 status) printf 'UI=%s\nAPI=%s\nPREVIOUS_UI=%s\nPREVIOUS_API=%s\n' \
   "$(readlink -f "$LIVE")" "$(readlink -f "$RUNTIME")" \
   "$(cat "$BASE/.previous-release" 2>/dev/null || echo none)" \
   "$(cat "$NEXT/.previous-runtime" 2>/dev/null || echo none)";;
esac
