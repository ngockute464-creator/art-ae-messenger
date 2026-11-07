import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync('public/index.html','utf8');
const sw=readFileSync('public/sw.js','utf8');
const client=readFileSync('public/push-client.js','utf8');
const pwa=readFileSync('public/pwa-client.js','utf8');
const app=readFileSync('public/app.js','utf8');
const api=readFileSync('migration/runtime/push.mjs','utf8');
const sync=readFileSync('migration/runtime/sync.mjs','utf8');
assert.match(html,/push-client\.js/);
for(const needle of ["addEventListener('push'","addEventListener('notificationclick'",
 "showNotification('АРТ-АЕ'","ARTAE_PUSH_OPEN","push_convo","'./push-client.js'"])
 assert.ok(sw.includes(needle),needle);
assert.ok(sw.includes("path.startsWith('/.netlify/functions/')"));
assert.match(pwa,/ARTAE_PUSH_MOUNT/);
assert.match(client,/Notification.requestPermission\(\)/);
assert.match(client,/userVisibleOnly:true/);
assert.match(app,/ARTAE_OPEN_PUSH_CONVERSATION/);
assert.match(api,/getSession\(req\)/);
assert.match(api,/session_sid/);
assert.match(sync,/ON CONFLICT\(id\) DO NOTHING RETURNING/);
assert.match(sync,/artae_push_deliveries/);
console.log('PUSH_ARTIFACT_TEST_OK version='+JSON.parse(readFileSync('public/app-version.json','utf8')).version);
