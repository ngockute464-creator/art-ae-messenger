import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const code=readFileSync('server/sync-client.js','utf8');
const convoA='11111111-1111-4111-8111-111111111111';
const convoB='22222222-2222-4222-8222-222222222222';
const pending={};
const queries=[];
const mockFetch=(url,options)=>{
 const id=new URL(String(url),'https://artae.example').searchParams.get('convo');
 queries.push({id,signal:options.signal});
 return new Promise(resolve=>{pending[id]=resolve});
};
const data={messages:[]},cursors={};
const context={
 convo:convoA,view:'chat',data,lastMessageCursor:cursors,syncBusy:false,
 syncLastError:'',document:{hidden:false},
 fetch:mockFetch,URLSearchParams,AbortController,Map,JSON,
 queueMicrotask,console,editing:null,modal:null,openMenu:null,
 $:()=>null,render:()=>{},messageView:m=>m.text
};
const sync=runInNewContext(code+'\nsyncMessages',context);
const makeResponse=(id,body,stamp)=>({
 ok:true,json:async()=>({messages:[{id,convo:id,text:body,time:stamp}],cursor:stamp,initial:true,hasMore:false})
});
const first=sync(true);
assert.deepEqual(queries.map(x=>x.id),[convoA]);
context.convo=convoB;
const second=sync(true);
assert.deepEqual(queries.map(x=>x.id),[convoA,convoB],'New chat must fetch immediately without old response');
assert.equal(queries[0].signal.aborted,true,'Old chat request aborted');
assert.equal(queries[1].signal.aborted,false,'New chat request still active');
// Even a browser/service worker that resolves the old response after abort must not
// overwrite the new conversation or mark the current fetch idle.
pending[convoA](makeResponse(convoA,'stale',11));
await first;
assert.equal(context.syncBusy,true,'Stale finally must not mark new request idle');
assert.equal(cursors[convoA],undefined,'Stale response cannot advance cursor');
assert.equal(data.messages.length,0);
pending[convoB](makeResponse(convoB,'new',22));
await second;
assert.equal(context.syncBusy,false);
assert.equal(cursors[convoB],22);
assert.equal(data.messages.length,1);
assert.equal(data.messages[0].convo,convoB);
assert.equal(data.messages[0].text,'new');
assert.equal(queries.length,2,'No redundant retry after switch');
console.log('FAST_CONVERSATION_SWITCH_OK abort_old=true new_immediate=true stale_response_ignored=true cursor_consistent=true');
