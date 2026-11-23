import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('server/labels-client.js','utf8');
const project='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
let serverLabels=[],renderCount=0,polls=0,activeProject=project;
const data={labels:[{kind:'message',item:'m2',name:'Важное',project:other}]};
const ctx={
 data,convo:null,document:{body:{},activeElement:{id:''}},
 get project(){return activeProject},modal:null,editing:null,
 fetch:async()=>({ok:true,json:async()=>({labels:serverLabels})}),
 render:()=>{renderCount++},console:{warn:e=>{throw Error(String(e))}},
 Date,JSON,URLSearchParams,queueMicrotask,Map,Set,String,
};
runInNewContext(source,ctx);
const sync=ctx.refreshSharedLabels||runInNewContext(source+'\nrefreshSharedLabels',ctx);
await sync(true);
assert.equal(renderCount,0,'First empty-label poll must not rerender an empty chat');
assert.equal(data.labels.length,1,'Preserve labels from another project');
await sync(true);
assert.equal(renderCount,0,'Repeated unchanged poll must not rerender');
serverLabels=[{kind:'message',item:'m1',name:'Срочно'}];
await sync(true);
assert.equal(renderCount,1,'New label triggers one render');
await sync(true);
assert.equal(renderCount,1,'Identical repeated label must not render');
serverLabels=[{name:'Срочно',item:'m1',kind:'message'}];
await sync(true);
assert.equal(renderCount,1,'Different object key order is not a label change');
serverLabels=[{name:'Срочно',item:'m1',kind:'message'}, {kind:'file',item:'f1',name:'Проверено'}];
await sync(true);
assert.equal(renderCount,2,'Added label triggers update');
serverLabels.reverse();
await sync(true);
assert.equal(renderCount,2,'Server reorder alone must not flash the interface');
serverLabels=[];
await sync(true);
assert.equal(renderCount,3,'Removed label triggers update');
assert.deepEqual(data.labels,[{kind:'message',item:'m2',name:'Важное',project:other}]);
console.log('LABELS_NO_FLICKER_OK unchanged_poll_zero_render=true reorder_zero_render=true real_change_updates=true other_projects_preserved=true');
