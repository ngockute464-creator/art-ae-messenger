#!/usr/bin/env bash
# ART-AE VPS release manager. Requires root. Secrets remain in /etc/artae/artae.env.
set -Eeuo pipefail
umask 027

BASE=/opt/artae
RELEASES="$BASE/releases"
LIVE="$BASE/work"
REPO=https://github.com/ngockute464-creator/art-ae-messenger.git
BRANCH=netlify-preview
NODE=/opt/node/bin/node
LOCK=/run/lock/artae-deploy.lock
ACTION="${1:-}"

log() { printf '[artae-deploy] %s\n' "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }
[[ $(id -u) -eq 0 ]] || fail 'Run as root'
[[ "$ACTION" =~ ^(stage|promote|rollback|status)$ ]] || fail 'Usage: artae-release.sh {stage|promote|rollback|status} [release-id]'
[[ -x "$NODE" ]] || fail 'Missing Node.js binary'
mkdir -p "$RELEASES"
chmod 755 "$RELEASES"
exec 9>"$LOCK"
flock -n 9 || fail 'Another deployment is running'

health() {
  local response
  response=$(curl --fail --silent --show-error --max-time 12 'http://127.0.0.1:3100/.netlify/functions/auth?action=status') || return 1
  [[ "$response" == *'"initialized":true'* ]] || return 1
  curl --fail --silent --show-error --max-time 12 -o /dev/null \
    --resolve artae.duckdns.org:443:127.0.0.1 https://artae.duckdns.org/ || return 1
}

stage() {
  [[ -f /etc/artae/artae.env ]] || fail 'Missing /etc/artae/artae.env'
  local sha stamp id dir
  sha=$(git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -f1)
  [[ "$sha" =~ ^[a-f0-9]{40}$ ]] || fail 'Cannot resolve GitHub branch HEAD'
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  id="${stamp}-${sha:0:12}"
  dir="$RELEASES/$id"
  log "Staging $sha into $dir"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$dir"
  [[ $(git -C "$dir" rev-parse HEAD) == "$sha" ]] || fail 'Branch moved during cloning; retry'
  chown -R artae:artae "$dir"
  runuser -u artae -- bash -c 'cd "$1" && unzip -oq artae.zip -d . && "$2" build/prepare.mjs' -- "$dir" "$NODE"
  "$NODE" --check "$dir/vps-server.mjs"
  "$NODE" --check "$dir/public/app.js"
  for name in auth sync pins files-explorer realtime-token voice voice-transcript; do
    [[ -f "$dir/netlify/functions/$name.mjs" ]] || fail "Missing API handler $name"
    "$NODE" --check "$dir/netlify/functions/$name.mjs"
  done
  [[ -s "$dir/public/index.html" && -s "$dir/public/sw.js" ]] || fail 'Frontend missing'
  printf '%s\n' "$sha" > "$dir/.release-commit"
  chown -R artae:artae "$dir"
  chmod -R go-w "$dir"
  log "STAGED=$id"
  log 'Production was not changed.'
}

wait_healthy() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if health; then return 0; fi
    sleep 1
  done
  return 1
}

resolve_release() {
  local id="$1"
  [[ "$id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$ ]] || fail 'Invalid release ID'
  [[ -d "$RELEASES/$id" && -s "$RELEASES/$id/.release-commit" ]] || fail 'Release not found or not staged'
  printf '%s' "$RELEASES/$id"
}

set_live() {
  local target="$1" temp="$BASE/.work.next.$$"
  [[ -d "$target" ]] || fail "Target directory not found: $target"
  [[ ! -e "$LIVE" || -L "$LIVE" ]] || fail 'Live path is a real directory; initial transition required'
  ln -s "$target" "$temp"
  mv -Tf "$temp" "$LIVE"
}

PROMOTE_RECOVERY=''
recover_promote() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "$PROMOTE_RECOVERY" ]]; then
    log "Recovering previous live version: $PROMOTE_RECOVERY"
    if [[ -L "$LIVE" ]]; then
      local temp="$BASE/.work.recover.$$"
      ln -s "$PROMOTE_RECOVERY" "$temp"
      mv -Tf "$temp" "$LIVE"
    elif [[ ! -e "$LIVE" ]]; then
      ln -s "$PROMOTE_RECOVERY" "$LIVE"
    fi
    systemctl restart artae || true
  fi
  exit "$status"
}

promote() {
  [[ $# -eq 1 ]] || fail 'Usage: promote RELEASE_ID'
  local target previous legacy
  target=$(resolve_release "$1")
  [[ -d "$LIVE" ]] || fail 'Missing live directory'
  [[ $(systemctl is-active artae) == active ]] || fail 'ART-AE service is not active'
  [[ $(systemctl is-active caddy) == active ]] || fail 'Caddy service is not active'
  health || fail 'Existing production is unhealthy; do not deploy'
  if [[ -L "$LIVE" ]]; then
    previous=$(readlink -f "$LIVE")
  else
    legacy="$RELEASES/legacy-$(date -u +%Y%m%dT%H%M%SZ)"
    [[ ! -e "$legacy" ]] || fail 'Legacy snapshot collision'
    previous="$legacy"
  fi
  [[ "$target" != "$previous" ]] || fail 'Release already active'
  PROMOTE_RECOVERY="$previous"
  trap recover_promote EXIT HUP INT TERM
  if [[ -n "${legacy:-}" ]]; then
    log "Preserving original working tree: $legacy"
    mv "$LIVE" "$legacy"
  fi
  log "Switching $LIVE to $target"
  set_live "$target"
  systemctl restart artae || fail 'ART-AE service restart failed'
  wait_healthy || fail 'New release health check failed'
  printf '%s\n' "$previous" > "$BASE/.previous-release"
  PROMOTE_RECOVERY=''
  trap - EXIT HUP INT TERM
  log "DEPLOYED=$target"
  log "PREVIOUS=$previous"
}

rollback() {
  [[ -f "$BASE/.previous-release" ]] || fail 'No previous release recorded'
  local previous current
  previous=$(cat "$BASE/.previous-release")
  [[ "$previous" == "$RELEASES/"* && -d "$previous" ]] || fail 'Invalid previous release path'
  [[ -L "$LIVE" ]] || fail 'Live directory is not a symlink'
  current=$(readlink -f "$LIVE")
  set_live "$previous"
  if ! systemctl restart artae || ! wait_healthy; then
    set_live "$current"
    systemctl restart artae || true
    fail 'Rollback health failed; original release restored'
  fi
  printf '%s\n' "$current" > "$BASE/.previous-release"
  log "ROLLED_BACK_TO=$previous"
}

case "$ACTION" in
  stage) stage;;
  promote) promote "${2:-}";;
  rollback) rollback;;
  status) printf 'LIVE=%s\nPREVIOUS=%s\n' "$(readlink -f "$LIVE")" "$(cat "$BASE/.previous-release" 2>/dev/null || echo none)";;
esac
