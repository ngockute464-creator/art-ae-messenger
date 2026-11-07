#!/usr/bin/env bash
# ART-AE updater: server-side pull only after GitHub Actions verified exact commit.
# Modes: check (read-only), deploy (stage + promote if CI succeeded).
set -Eeuo pipefail
umask 027

MODE="${1:-check}"
[[ "$MODE" == check || "$MODE" == deploy ]] || { echo 'Usage: artae-auto.sh [check|deploy]' >&2; exit 2; }
[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 2; }

REPO='ngockute464-creator/art-ae-messenger'
BRANCH='netlify-preview'
URL="https://github.com/$REPO.git"
API="https://api.github.com/repos/$REPO/actions/workflows/verify-vps.yml/runs"
MANAGER=/root/artae-release.sh
LIVE=/opt/artae/work
NODE=/opt/node/bin/node

# Avoid overlapping two timer invocations.
exec 8>/run/lock/artae-auto.lock
flock -n 8 || { echo '[artae-auto] Another updater is active'; exit 0; }

[[ -x "$NODE" && -f "$MANAGER" ]] || { echo '[artae-auto] Missing runtime or release manager' >&2; exit 1; }

HEAD=$(git ls-remote "$URL" "refs/heads/$BRANCH" | cut -f1)
[[ "$HEAD" =~ ^[0-9a-f]{40}$ ]] || { echo '[artae-auto] Invalid GitHub HEAD' >&2; exit 1; }

CURRENT='unknown'
if [[ -r "$LIVE/.release-commit" ]]; then
  CURRENT=$(cat "$LIVE/.release-commit")
fi

if [[ "$HEAD" == "$CURRENT" ]]; then
  printf '[artae-auto] Already current: %s\n' "${HEAD:0:12}"
  exit 0
fi

# Query the exact workflow and exact head SHA. A success on an older SHA is not sufficient.
JSON=$(mktemp)
trap 'rm -f "$JSON"' EXIT
curl --fail --silent --show-error --retry 2 --max-time 25 \
  -H 'Accept: application/vnd.github+json' \
  -H 'User-Agent: artae-vps-deploy' \
  "$API?branch=$BRANCH&head_sha=$HEAD&per_page=20" -o "$JSON"

STATE=$("$NODE" - "$HEAD" "$JSON" <<'NODE'
const fs = require('node:fs');
const [sha, file] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
const matching = runs.filter(x =>
  x.head_sha === sha &&
  x.event === 'push' &&
  x.path === '.github/workflows/verify-vps.yml'
);
if (matching.some(x => x.status === 'completed' && x.conclusion === 'success')) {
  console.log('success');
} else if (matching.some(x => x.status !== 'completed')) {
  console.log('pending');
} else if (matching.some(x => x.status === 'completed')) {
  console.log('failed');
} else {
  console.log('missing');
}
NODE
)

printf '[artae-auto] HEAD=%s CURRENT=%s CI=%s\n' "${HEAD:0:12}" "${CURRENT:0:12}" "$STATE"
[[ "$STATE" == success ]] || exit 0
[[ "$MODE" == deploy ]] || { echo '[artae-auto] Approved for deployment; dry-run only'; exit 0; }

# Do not deploy a different HEAD if another push happened after checking CI.
NEW_HEAD=$(git ls-remote "$URL" "refs/heads/$BRANCH" | cut -f1)
[[ "$NEW_HEAD" == "$HEAD" ]] || { echo '[artae-auto] HEAD changed; retry next tick'; exit 0; }

# A new stage always clones a clean checkout and verifies the commit is stable.
STAGE_OUTPUT=$(bash "$MANAGER" stage)
printf '%s\n' "$STAGE_OUTPUT"
ID=$(printf '%s\n' "$STAGE_OUTPUT" | sed -n 's/^\[artae-deploy\] STAGED=//p' | tail -1)
[[ "$ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$ ]] || { echo '[artae-auto] Missing staged release ID' >&2; exit 1; }
STAGED_SHA=$(cat "/opt/artae/releases/$ID/.release-commit")
[[ "$STAGED_SHA" == "$HEAD" ]] || { echo '[artae-auto] Staged commit does not match verified SHA' >&2; exit 1; }

bash "$MANAGER" promote "$ID"
printf '[artae-auto] DEPLOYED_SHA=%s\n' "$HEAD"
