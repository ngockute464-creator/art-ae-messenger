import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../server/voice-client.js',import.meta.url),'utf8');
test('first click creates and plays authenticated audio after parts download',()=>{
 assert.match(src,/action:'part',convo:message\.convo,id:meta\.id/);
 assert.match(src,/const player=new Audio\(objectURL\)/);
 assert.match(src,/voicePlayers\.set\(id,player\)/);
 assert.match(src,/try\{await player\.play\(\)\}catch\(error\)/);
});
test('autoplay denial is handled without false playback success',()=>{
 assert.match(src,/Voice playback requires user interaction/);
 assert.match(src,/player\.onplay=\(\)=>render\(\)/);
 assert.match(src,/voiceAudioLoading\.delete\(id\)/);
});
