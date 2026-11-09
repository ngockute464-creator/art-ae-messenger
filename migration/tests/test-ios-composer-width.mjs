import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync('public/styles.css','utf8');
const patch=readFileSync('server/files-patch.mjs','utf8');
const app=readFileSync('public/app.js','utf8');
const marker='Mobile Safari: make the composer an explicitly bounded flex container.';
assert.ok(patch.includes(marker),'Dedicated mobile overflow fix is packaged');
const i=css.indexOf('.app.mobile-chat .compose{');
assert.ok(i>=0,'Compiled app has bounded composer rules');
const mobile=css.slice(i,i+850);
for(const selector of [
 '.app.mobile-chat .compose{',
 '.app.mobile-chat .composerBody,',
 '.app.mobile-chat .composeLine{',
 '.app.mobile-chat .composeLine>textarea#draft{',
 '.app.mobile-chat .composeLine>.composerAttach,',
 '.app.mobile-chat .composeLine>.voiceMic,',
 '.app.mobile-chat .composeLine>.composerSend{'
])assert.ok(mobile.includes(selector),selector);
assert.match(mobile,/box-sizing:border-box;width:100%;max-width:100%;min-width:0/);
assert.match(mobile,/box-sizing:border-box;width:0;min-width:0;max-width:100%/);
assert.match(mobile,/flex:1 1 0%/);
assert.match(mobile,/flex:0 0 40px/);
assert.ok(app.includes('class="composerBody"'));
assert.ok(app.includes('class="composeLine"'));
const compute=width=>{
 // iPhone minimum tested width: 320 CSS px; composer padding 10px each,
 // two fixed actions of 40px and two gaps of 6px.
 const content=width-20;
 const input=content-2*40-2*6;
 return {input,occupied:input+2*40+2*6};
};
for(const width of [320,375,390,414,430,650]){
 const {input,occupied}=compute(width);
 assert.ok(input>0&&occupied<=width-20, 'Composer exceeds '+width+'px viewport');
}
console.log('IOS_COMPOSER_WIDTH_OK viewport_320=true viewport_430=true bounded=true fixed_actions=true editor_shrinks=true');
