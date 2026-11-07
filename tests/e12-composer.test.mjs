import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const patch=readFileSync(new URL('../server/files-patch.mjs',import.meta.url),'utf8');
const voice=readFileSync(new URL('../server/voice-client.js',import.meta.url),'utf8');
test('composer uses paper-plane send and accessible controls',()=>{
 assert.match(patch,/composerSend/);
 assert.match(patch,/aria-label="Отправить сообщение"/);
 assert.match(patch,/composerAttach/);
 assert.match(voice,/data-act="voiceStart"/);
 assert.match(voice,/viewBox="0 0 24 24"/);
});
test('single line placeholder and uniform 40px controls',()=>{
 assert.match(patch,/rows="1" placeholder="Сообщение\.\.\."/);
 assert.match(patch,/min-height:40px/);
 assert.ok(patch.includes('.composeLine>textarea#draft'));
 assert.match(patch,/voiceHoldStatus/);
});
