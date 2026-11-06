// E1 paginated sync: never commit a partial cursor.
let syncPending=false;
async function syncMessages(force=false){
 if(!convo||document.hidden)return;
 if(syncBusy){if(force)syncPending=true;return}
 syncBusy=true;const id=convo;
 try{
  const since=lastMessageCursor[id]||0,all=[];let next=null,first=null,finalCursor=null;
  for(let page=0;page<250;page++){
   if(convo!==id)return;
   const opts={action:'messages',convo:id,paging:'1'};
   if(since)opts.since=String(since);if(next)opts.page=next;
   const response=await fetch('/.netlify/functions/sync?'+new URLSearchParams(opts),{credentials:'same-origin',cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Не удалось получить сообщения');
   if(!Array.isArray(result.messages)||!Number.isSafeInteger(result.cursor))throw Error('Некорректный ответ синхронизации');
   if(first===null)first=!!result.initial;
   if(finalCursor!==null&&finalCursor!==result.cursor)throw Error('Изменился курсор между страницами');
   finalCursor=result.cursor;all.push(...result.messages);
   if(!result.hasMore){next=null;break}
   if(typeof result.nextCursor!=='string'||!result.nextCursor||result.nextCursor===next)throw Error('Неверная пагинация сообщений');
   next=result.nextCursor;
  }
  if(next)throw Error('Превышено количество страниц синхронизации');
  if(convo!==id)return;
  const oldSnapshot=JSON.stringify(data.messages.filter(m=>m.convo===id));
  const rows=new Map(data.messages.filter(m=>m.convo===id).map(m=>[m.id,m]));
  if(first)for(const [key,value] of rows){if(!value.pending)rows.delete(key)}
  for(const m of all){if(m.deletedAt)rows.delete(m.id);else rows.set(m.id,m)}
  data.messages=data.messages.filter(m=>m.convo!==id).concat([...rows.values()]);
  lastMessageCursor[id]=finalCursor;
  if(convo===id&&view==='chat'&&!editing&&!modal&&!openMenu&&JSON.stringify(data.messages.filter(m=>m.convo===id))!==oldSnapshot){
   const list=$('msgscroll');
   if(list&&list.dataset.convo===id){
    const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90,scroll=list.scrollTop;
    const messages=data.messages.filter(m=>m.convo===id).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
    list.innerHTML=messages.length?messages.map(messageView).join(''):'<div class="empty"><h3>Пока нет сообщений</h3><p>Начни обсуждение.</p></div>';
    list.scrollTop=atBottom?list.scrollHeight:scroll;
   }else render();
  }
 }catch(error){syncLastError=String(error.message||error);console.warn('Message sync',error)}
 finally{syncBusy=false;if(convo&&(convo!==id||syncPending)){syncPending=false;queueMicrotask(()=>syncMessages(true))}}
}