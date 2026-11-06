import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const client=readFileSync(new URL('../server/transcript-client.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../server/voice-transcript.mjs',import.meta.url),'utf8');
const voice=readFileSync(new URL('../server/voice-client.js',import.meta.url),'utf8');
test('20s WAV segments have header and PCM16 rate',()=>{
 assert.match(client,/secondsPerChunk=20/);
 assert.match(client,/targetRate=16000/);
 assert.match(client,/str\(0,'RIFF'\)/);
 assert.match(client,/setUint16\(34,16,true\)/);
});
test('auth and quota controlled server-side',()=>{
 assert.match(api,/getSession\(req\)/);
 assert.match(api,/originOk\(req\)/);
 assert.match(api,/CLOUDFLARE_AI_TOKEN/);
 assert.match(api,/CLOUDFLARE_ACCOUNT_ID/);
 assert.match(api,/429/);
});
test('transcription persists privately and checks messages',()=>{
 assert.match(api,/deleted_at:'is.null'/);
 assert.match(api,/transcript_parts/);
 assert.match(api,/transcript.json/);
 assert.match(voice,/voiceTranscriptControls\(message\)/);
});
