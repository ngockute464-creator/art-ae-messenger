// Reproducible build overlay. Keep released ZIP intact and swap only server adapter.
import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
copyFileSync('server/sync-pg.mjs','netlify/functions/sync.mjs');
copyFileSync('server/realtime-token.mjs','netlify/functions/realtime-token.mjs');
const file='public/app.js';
let app=readFileSync(file,'utf8');
function replaceOnce(before,after,label){
  if(!app.includes(before)) throw Error('Expected app.js version mismatch: '+label);
  app=app.replace(before,after);
}
replaceOnce(
  "setInterval(()=>{if(!document.hidden&&syncReady)syncMessages()},15000);",
  "setInterval(()=>{if(!document.hidden&&syncReady&&(!rtConnected||Date.now()-rtLastFallback>45000)){rtLastFallback=Date.now();syncMessages()}},5000);",
  'polling interval'
);
// Compare messages and update the message list only when it actually changed.
// Never replace the composer DOM on background polling: replacing textarea destroys focus.
replaceOnce(
  "const rows=new Map(data.messages.filter(m=>m.convo===id).map(m=>[m.id,m]));",
  "const oldSnapshot=JSON.stringify(data.messages.filter(m=>m.convo===id));const rows=new Map(data.messages.filter(m=>m.convo===id).map(m=>[m.id,m]));",
  'message snapshot'
);
replaceOnce(
  "if(convo===id&&view==='chat'&&!editing&&!modal&&!openMenu)render();",
  "if(convo===id&&view==='chat'&&!editing&&!modal&&!openMenu&&JSON.stringify(data.messages.filter(m=>m.convo===id))!==oldSnapshot){const list=$('msgscroll');if(list&&list.dataset.convo===id){const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;const scroll=list.scrollTop;const messages=data.messages.filter(m=>m.convo===id).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));list.innerHTML=messages.length?messages.map(messageView).join(''):'<div class=\"empty\"><h3>Пока нет сообщений</h3><p>Начни обсуждение.</p></div>';list.scrollTop=atBottom?list.scrollHeight:scroll;}else render();}",
  'partial message update'
);
// Background project refresh must not destroy focused input.
replaceOnce(
  "if((changed||!syncReady)&&!modal&&!editing)render()}",
  "if((changed||!syncReady)&&!modal&&!editing&&document.activeElement?.id!=='draft')render()}",
  'overview focus guard'
);

const realtimeClient=readFileSync('server/realtime-client.js','utf8');
replaceOnce('function cp(){',realtimeClient+'\nfunction cp(){','Realtime client');
replaceOnce(
  "function openChat(id){convo=id;highlightId=null;switchView('chat');syncMessages(true)}",
  "function openChat(id){convo=id;highlightId=null;switchView('chat');syncMessages(true);connectRealtime(id)}",
  'open private channel'
);
replaceOnce(
  'function switchView(v){openMenu=null;view=v;render();',
  "function switchView(v){if(v!=='chat')stopRealtime();openMenu=null;view=v;render();",
  'close private channel on navigation'
);
replaceOnce(
  "document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncOverview().catch(()=>{});syncMessages(true)}})",
  "document.addEventListener('visibilitychange',()=>{if(document.hidden)stopRealtime();else{syncOverview().catch(()=>{});syncMessages(true);if(convo&&view==='chat')connectRealtime(convo)}})",
  'resume after page visibility'
);
replaceOnce(
  "view='chat';syncMessages(true);",
  "view='chat';syncMessages(true);connectRealtime(convo);",
  'join newly created conversation'
);
writeFileSync(file,app);
const sw='public/sw.js';
let worker=readFileSync(sw,'utf8').replace('art-ae-shared-text-v1','art-ae-private-realtime-v1');
writeFileSync(sw,worker);
console.log('ART-AE: private Realtime enabled with safe polling fallback');
