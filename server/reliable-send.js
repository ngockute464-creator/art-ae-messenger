// E6 — keep unconfirmed messages and safely retry the exact same UUID.
function repaintOutgoing(cid){
 if(convo!==cid||view!=='chat')return;
 const list=$('msgscroll');if(!list||list.dataset.convo!==cid)return;
 const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<90,scroll=list.scrollTop;
 const rows=data.messages.filter(m=>m.convo===cid).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 list.innerHTML=rows.length?rows.map(messageView).join(''):'<div class="empty"><h3>Пока нет сообщений</h3></div>';
 list.scrollTop=bottom?list.scrollHeight:scroll;
}
function dispatchOutgoing(m){
 if(m.pending||!m.sendFailed||data.messages.find(row=>row.id===m.id)!==m)return;
 m.sendFailed=false;m.pending=true;repaintOutgoing(m.convo);
 syncApi('send',{convo:m.convo,text:m.text,requestId:m.id}).then(r=>{
  if(!r?.message||r.message.id!==m.id)throw Error('Сервер не подтвердил сообщение');
  data.messages=data.messages.filter(row=>row!==m&&row.id!==m.id).concat([r.message]);
  repaintOutgoing(m.convo);if(convo===m.convo)syncMessages(true);
 }).catch(err=>{
  if(data.messages.find(row=>row.id===m.id)!==m)return;
  m.pending=false;m.sendFailed=true;m.sendError=String(err?.message||err).slice(0,180);
  syncLastError=m.sendError;repaintOutgoing(m.convo);
  if(convo===m.convo)syncMessages(true);
 });
}
function queueOutgoing(cid,text){
 const m={id:crypto.randomUUID(),convo:cid,authorId:userId(),who:meName(),text,
  time:Date.now(),editedAt:null,deletedAt:null,pending:false,sendFailed:true};
 data.messages.push(m);
 const d=drafts[cid];if(d)d.text='';
 const field=$('draft');if(convo===cid&&field)field.value='';
 repaintOutgoing(cid);if(typeof composerRefresh==='function')composerRefresh();dispatchOutgoing(m);
}
function retryOutgoing(id){
 const m=data.messages.find(row=>row.id===id);
 if(m&&m.authorId===userId()&&m.sendFailed&&!m.pending)dispatchOutgoing(m);
}
window.addEventListener('online',()=>{
 for(const m of [...data.messages])if(m.sendFailed&&m.authorId===userId())dispatchOutgoing(m);
 if(convo)syncMessages(true);
});
