import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const client=readFileSync(new URL('../server/voice-client.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../server/voice-api.mjs',import.meta.url),'utf8');
const patch=readFileSync(new URL('../server/files-patch.mjs',import.meta.url),'utf8');
const build=readFileSync(new URL('../build/prepare.mjs',import.meta.url),'utf8');
test('recording has no fixed time stop and uses MediaRecorder mime support',()=>{
 assert.match(client,/MediaRecorder\.isTypeSupported/);
 assert.match(client,/rec\.start\(15000\)/);
 assert.doesNotMatch(client,/setTimeout\([^)]*rec\.stop/);
});
test('upload uses bounded slices, same UUID for DB message',()=>{
 assert.match(client,/partSize=1024\*1024/);
 assert.match(client,/requestId:d\.id/);
 assert.match(api,/MAX_CHUNK=1280\*1024/);
});
test('playback requires authenticated convo and committed message',()=>{
 assert.match(api,/getSession\(request\)/);
 assert.match(api,/conversation_id:'eq\.'\+convo/);
 assert.match(api,/deleted_at:'is.null'/);
});
test('voice UI and Netlify build connected',()=>{
 assert.match(patch,/voiceClient=readFileSync/);
 assert.match(patch,/voiceMicButton/);
 assert.match(patch,/voiceMessageHtml/);
 assert.match(build,/voice-api\.mjs/);
});
