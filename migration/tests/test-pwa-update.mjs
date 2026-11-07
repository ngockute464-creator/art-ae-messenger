// CI assertions against the REAL generated assets from artae.zip + overlays.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const html=readFileSync('public/index.html','utf8');
const metadata=JSON.parse(readFileSync('public/app-version.json','utf8'));
const sw=readFileSync('public/sw.js','utf8');
const pwa=readFileSync('public/pwa-client.js','utf8');
const app=readFileSync('public/app.js','utf8');
assert.match(sha,/^[0-9a-f]{40}$/);
assert.equal(metadata.build,sha,'Version endpoint must reflect the exact staged commit');
assert.ok(html.includes('name="artae-build" content="'+sha+'"'),'HTML must use same exact SHA');
assert.ok(html.includes('name="artae-version" content="'+metadata.version+'"'),'Human versions must match');
assert.ok(sw.includes("const CACHE='art-ae-release-"+sha.slice(0,16)+"'"),'SW cache must be versioned');
for(const fragment of [
 "path==='/app-version.json'",
 "path.startsWith('/.netlify/functions/')",
 "path.startsWith('/office/')",
 "path.startsWith('/api/')",
 "fetch(req,{cache:'no-store'})",
 "k.startsWith('art-ae-')&&k!==CACHE",
 'await self.skipWaiting()',
 'await self.clients.claim()'
]) assert.ok(sw.includes(fragment),'SW missing '+fragment);
assert.ok(sw.indexOf("fetch(req,{cache:'no-store'})") < sw.lastIndexOf('cache.match('),
 'Online shell requests must use the network before fallback');
for(const fragment of [
 'window.ARTAE_CAN_AUTO_RELOAD','voiceDraft','chatPendingFiles','chatSending',
 'explorerUploading','explorerDeleting','data.messages','drafts'
]) assert.ok(app.includes(fragment),'Safe-update policy missing '+fragment);
for(const fragment of [
 "fetch('/app-version.json?check='",
 "navigator.serviceWorker.getRegistration()",
 'document.hidden','maybeUpdate()','location.replace(target.toString())'
]) assert.ok(pwa.includes(fragment),'PWA client missing '+fragment);
console.log('PWA_RELEASE_CI_OK sha='+sha+' version='+metadata.version);
