import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../server/voice-client.js',import.meta.url),'utf8');
test('first click attempts autoplay after authenticated part fetch',()=>{
 assert.match(src,/const player=\[\.\.\.document\.querySelectorAll\('\.voiceMessage audio'\)\]/);
 assert.match(src,/await player\.play\(\)/);
 assert.match(src,/voiceAudioLoading\.delete\(id\);\s*render\(\);/);
});
test('autoplay denial retains native controls rather than claiming success',()=>{
 assert.match(src,/catch\(error\)\{\s*\/\/ Safari can reject play/);
 assert.match(src,/audio controls preload="metadata"/);
});
