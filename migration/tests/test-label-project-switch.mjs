import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync('server/labels-client.js','utf8');
const start=code.indexOf('async function refreshSharedLabels('),end=code.indexOf('async function saveSharedLabels(');
assert.ok(start>=0&&end>start);
const snippet=code.slice(start,end);
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
let resolveA,requests=[],renders=0;
const env={
 project:a,labelsBusy:false,labelsPending:false,labelsProject:null,labelsLastFetch:0,
 data:{labels:[]},document:{body:true,activeElement:null},modal:null,editing:null,Date,console,
 render(){renders++},
 queueMicrotask(fn){queueMicrotask(fn)},
 async labelsRequest(_action,{project}){
  requests.push(project);
  if(project===a)return await new Promise(resolve=>{resolveA=resolve});
  return {labels:[{kind:'message',item:'b-message',name:'B'}]};
 }
};
const refresh=runInNewContext(snippet+'\nrefreshSharedLabels',env);
const first=refresh(true);
assert.deepEqual(requests,[a]);
env.project=b;
await refresh(true);
assert.equal(env.labelsPending,true,'B must be queued during A');
resolveA({labels:[{kind:'message',item:'a-message',name:'A'}]});
await first;
for(let i=0;i<20&&requests.length<2;i++)await new Promise(r=>setImmediate(r));
assert.deepEqual(requests,[a,b],'B must start immediately after A finishes');
for(let i=0;i<20&&env.labelsProject!==b;i++)await new Promise(r=>setImmediate(r));
assert.equal(env.labelsProject,b);
assert.deepEqual(env.data.labels.map(x=>x.name),['B'],'Stale A response must not replace B');
assert.equal(env.labelsBusy,false);
assert.ok(renders>=1);
console.log('LABEL_PROJECT_SWITCH_OK pending=true immediate_replay=true stale_response_ignored=true');
