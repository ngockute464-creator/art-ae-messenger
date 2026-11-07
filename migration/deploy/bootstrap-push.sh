#!/usr/bin/env bash
# ART-AE one-time, pinned, reversible infrastructure preparation. Does NOT deploy.
set -Eeuo pipefail
umask 077
trap 'code=$?; printf "[push] ERROR at line %s (exit %s)\n" "$LINENO" "$code" >&2' ERR
[[ $(id -u) -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
EXPECTED_SHA="$1"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Provide pinned SHA' >&2; exit 1; }
export PATH="/usr/local/bin:/opt/node/bin:$PATH"
command -v npm >/dev/null
command -v pg_dump >/dev/null
command -v psql >/dev/null
[[ -x /usr/local/bin/node && -d /opt/artae-next/node_modules/pg && -f /etc/artae/artae.env ]] || exit 1
exec 9>/run/lock/artae-push-bootstrap.lock
flock -n 9 || exit 1
STAGE="$(mktemp -d /tmp/artae-push.XXXXXXXX)"
trap 'rm -rf "$STAGE"' EXIT
git clone -q --depth 1 --branch feature/web-push https://github.com/ngockute464-creator/art-ae-messenger.git "$STAGE/repo"
[[ "$(git -C "$STAGE/repo" rev-parse HEAD)" == "$EXPECTED_SHA" ]] || {
 echo 'Feature branch moved; refusing unpinned schema update' >&2; exit 1;
}
[[ -s "$STAGE/repo/migration/sql/004_web_push.sql" ]] || exit 1
echo '[push] Installing pinned transport separately from the production API dependencies'
DEPS='/opt/artae-next/push-deps'
install -d -m 755 "$DEPS"
npm install --prefix "$DEPS" --no-save --ignore-scripts --no-audit --no-fund web-push@3.6.7 >/dev/null
# umask 077 is essential for VAPID secrets, but npm modules are code loaded by
# the restricted artae_app runtime: make ONLY the public dependency tree readable.
chmod -R a+rX "$DEPS/node_modules"
/usr/local/bin/node -e "if(require('$DEPS/node_modules/web-push/package.json').version!=='3.6.7')process.exit(1)"
echo '[push] Preparing private VAPID keys'
ARTAE_DEP_PATH="$DEPS/node_modules/web-push" /usr/local/bin/node <<'NODE'
const fs=require('node:fs'),path='/etc/artae/artae.env';
const value=fs.readFileSync(path,'utf8');
const hasPub=/^ARTAE_VAPID_PUBLIC_KEY=/m.test(value);
const hasPriv=/^ARTAE_VAPID_PRIVATE_KEY=/m.test(value);
if(hasPub!==hasPriv)throw Error('Partial VAPID config, refusing overwrite');
if(hasPub){console.log('[push] Existing key pair preserved');process.exit(0)}
const keys=require(process.env.ARTAE_DEP_PATH).generateVAPIDKeys();
const stat=fs.statSync(path);
const tmp=path+'.push-next-'+process.pid;
const text=value+(value.endsWith('\n')?'':'\n')+
 'ARTAE_VAPID_PUBLIC_KEY='+keys.publicKey+'\n'+
 'ARTAE_VAPID_PRIVATE_KEY='+keys.privateKey+'\n';
fs.writeFileSync(tmp,text,{mode:stat.mode&0o777});
fs.chownSync(tmp,stat.uid,stat.gid);
fs.renameSync(tmp,path);
console.log('[push] VAPID generated (secret not displayed)');
NODE
# systemd reads the root-owned EnvironmentFile and passes VAPID values to the
# service. The artae_app Unix account must NOT read the secret file directly.
[[ -s /etc/artae/artae.env ]] || { echo '[push] Environment file missing' >&2; exit 1; }
echo '[push] Backing up PostgreSQL'
install -d -m 700 /var/backups/artae
BACKUP="/var/backups/artae/pre-push-$(date -u +%Y%m%dT%H%M%SZ).dump"
[[ ! -e "$BACKUP" ]] || exit 1
runuser -u postgres -- pg_dump -Fc -d artae > "$BACKUP"
[[ -s "$BACKUP" ]] || exit 1
runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d artae < "$STAGE/repo/migration/sql/004_web_push.sql"
runuser -u artae_app -- psql -X -v ON_ERROR_STOP=1 -d artae -At -c \
 'SELECT count(*) FROM public.artae_push_subscriptions' >/dev/null
runuser -u artae_app -- /usr/local/bin/node -e \
 "require('/opt/artae-next/push-deps/node_modules/web-push');import('/opt/artae-next/runtime/postgres.mjs').then(async m=>{await m.assertLocalDatabase();await m.closePool()})"
echo '[push] Checking egress to browser push networks'
for host in web.push.apple.com fcm.googleapis.com updates.push.services.mozilla.com; do
 if curl --head --silent --show-error --connect-timeout 4 --max-time 7 -o /dev/null "https://$host/"; then
  echo "[push] $host reachable"
 else
  echo "[push] WARNING: $host could not be reached in this test"
 fi
done
echo "ARTAE_PUSH_BOOTSTRAP_OK schema=004 transport=3.6.7 backup=$BACKUP live_unchanged=true"
