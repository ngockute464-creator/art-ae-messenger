// Reproducible build overlay. Keep released ZIP intact and swap only server adapter.
import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
copyFileSync('server/sync-pg.mjs','netlify/functions/sync.mjs');
copyFileSync('server/project-rename.mjs','netlify/functions/project-rename.mjs');
copyFileSync('server/files-explorer.mjs','netlify/functions/files-explorer.mjs');
copyFileSync('server/pins-api.mjs','netlify/functions/pins.mjs');
copyFileSync('server/realtime-token.mjs','netlify/functions/realtime-token.mjs');
copyFileSync('server/jwt-standby-probe.mjs','netlify/functions/jwt-standby-probe.mjs');
copyFileSync('netlify/functions/auth.mjs','netlify/functions/auth-disk.mjs');
copyFileSync('server/auth-migrate.mjs','netlify/functions/auth-migrate.mjs');
copyFileSync('server/auth-pg.mjs','netlify/functions/auth-pg.mjs');
// Activate PostgreSQL authentication only after successful user/session comparison.
copyFileSync('server/auth-pg.mjs','netlify/functions/auth.mjs');
copyFileSync('server/auth-compare.mjs','netlify/functions/auth-compare.mjs');
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

// Optimistic local sending: message appears immediately, while PostgreSQL remains the source of truth.
// Repainting only #msgscroll is important: otherwise the composer loses focus.
replaceOnce(
  "if(result.initial)rows.clear();for(const m of result.messages)",
  "if(result.initial){for(const [key,value] of rows){if(!value.pending)rows.delete(key)}}for(const m of result.messages)",
  'preserve in-flight messages during background synchronization'
);
replaceOnce(
  "function messageView(m){let fs=",
  "function messageView(m){let fs=",
  'message function presence'
);
replaceOnce(
  "\${m.editedAt?' · Изменено':''}",
  "\${m.editedAt?' · Изменено':''}\${m.pending?' · Отправляется…':''}",
  'sending status'
);
replaceOnce(
  "const btn=e.target.querySelector('button[type=submit]');if(btn?.disabled)return;if(btn){btn.disabled=true;btn.textContent='Отправляем…'}\n d.requestId=d.requestText===v&&d.requestId?d.requestId:crypto.randomUUID();d.requestText=v;\n syncApi('send',{convo:target,text:v,requestId:d.requestId}).then(r=>{if(!data.messages.some(x=>x.id===r.message.id))data.messages.push(r.message);drafts[target]={text:'',files:[]};render();syncMessages()}).catch(syncFail).finally(()=>{if(btn?.isConnected){btn.disabled=false;btn.textContent='Отправить'}})",
  "const btn=e.target.querySelector('button[type=submit]');if(btn?.disabled)return;const requestId=d.requestId=d.requestText===v&&d.requestId?d.requestId:crypto.randomUUID();d.requestText=v;if(btn){btn.disabled=true;btn.textContent='Отправляем…'}const temp={id:requestId,convo:target,authorId:userId(),who:meName(),text:v,time:Date.now(),editedAt:null,deletedAt:null,pending:true};data.messages.push(temp);d.text='';const area=$('draft');if(area)area.value='';const refresh=()=>{if(convo!==target||view!=='chat')return;const list=$('msgscroll');if(!list||list.dataset.convo!==target)return;const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90;list.innerHTML=data.messages.filter(m=>m.convo===target).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id)).map(messageView).join('');if(atBottom)list.scrollTop=list.scrollHeight;};refresh();syncApi('send',{convo:target,text:v,requestId}).then(r=>{data.messages=data.messages.filter(m=>m!==temp);if(!data.messages.some(m=>m.id===r.message.id))data.messages.push(r.message);delete d.requestId;delete d.requestText;refresh();syncMessages(true)}).catch(err=>{data.messages=data.messages.filter(m=>m!==temp);if(!getDraft().text&&convo===target){getDraft().text=v;if($('draft'))$('draft').value=v}else if(convo!==target&&!(drafts[target]?.text))drafts[target].text=v;refresh();syncFail(err)}).finally(()=>{if(btn?.isConnected){btn.disabled=false;btn.textContent='Отправить'}})"
  ,'optimistic send'
);

writeFileSync(file,app);
const sw='public/sw.js';
let worker=readFileSync(sw,'utf8').replace('art-ae-shared-text-v1','art-ae-tabbed-rail-v8');
writeFileSync(sw,worker);
await import('../server/files-patch.mjs');
// Reject stale or invalid generated client before publishing.
const finalClient=readFileSync('public/app.js','utf8');
new Function(finalClient);
for(const marker of ['desktopRail()', 'refreshPins()', 'fileEntryNameAction', 'restoreWorkplace()'])if(!finalClient.includes(marker))throw Error('Missing UX feature: '+marker);
console.log('ART-AE: private Realtime enabled with safe polling fallback');
