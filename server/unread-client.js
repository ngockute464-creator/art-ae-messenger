// ART-AE stage 1. Message counters and read receipts after actual viewing.
// All counts are authoritative in the local PostgreSQL API.
const artaeUnread={
 stats:new Map(),busy:false,lastFetch:0,seen:new Set(),inFlight:new Set(),
 firstVisible:new Map(),lastConversation:null,writeBusy:false
};
async function artaeFetchStats(){
 if(artaeUnread.busy||document.hidden||!syncReady)return;
 artaeUnread.busy=true;
 artaeUnread.lastFetch=Date.now();
 try{
  const response=await fetch('/.netlify/functions/sync?action=messageStats',
   {credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('Unread summary HTTP '+response.status);
  const body=await response.json();
  if(!Array.isArray(body.conversations))throw Error('Unread summary format');
  artaeUnread.stats=new Map(body.conversations.map(c=>[c.id,{
   total:Number(c.total)||0,unread:Number(c.unread)||0
  }]));
  artaeDecorateCounts();
 }catch(error){console.warn('Unread summary:',error.message)}
 finally{artaeUnread.busy=false}
}
function artaeDecorateCounts(){
 if(!root?.querySelectorAll||!artaeUnread.stats.size)return;
 const byProject=new Map();
 for(const c of data.convos){
  const num=artaeUnread.stats.get(c.id)?.unread||0;
  byProject.set(c.project,(byProject.get(c.project)||0)+num);
 }
 const nodes=root.querySelectorAll(
  '.sidebar .navitem[data-act="project"][data-id],.convos .navitem[data-act="chat"][data-id]');
 for(const el of nodes){
  if(el.closest('.actionDropdown,.menuWrap,.modal,.desktopRail'))continue;
  const id=el.dataset.id;
  const convoStat=artaeUnread.stats.get(id);
  const isProject=data.projects.some(p=>p.id===id);
  if(!convoStat&&!isProject)continue;
  let badge=el.querySelector(':scope > .artae-message-counts');
  const unread=isProject?(byProject.get(id)||0):convoStat.unread;
  const count=convoStat?.total??0;
  const markup=(convoStat?'<small class="artae-total" title="Всего сообщений">'+count+'</small>':'')+
   (unread?'<strong class="artae-unread" title="Непрочитанных сообщений">'+(unread>99?'99+':unread)+'</strong>':'');
  if(!badge&&markup){
   badge=document.createElement('span');badge.className='artae-message-counts';
   el.appendChild(badge);
  }
  if(badge&&badge.innerHTML!==markup)badge.innerHTML=markup;
 }
}
function artaeVisibleMessage(element,scroller){
 const rect=element.getBoundingClientRect(),pane=scroller.getBoundingClientRect();
 if(rect.height<=0||pane.height<=0)return false;
 const visible=Math.min(rect.bottom,pane.bottom,window.innerHeight)-
               Math.max(rect.top,pane.top,0);
 return visible>=Math.min(32,rect.height*.25);
}
function artaeScanReadMessages(){
 if(document.hidden||view!=='chat'||!convo||!syncReady||modal||editing)return;
 const scroller=root?.querySelector('#msgscroll');
 if(!scroller)return;
 if(artaeUnread.lastConversation!==convo){
  artaeUnread.firstVisible.clear();
  artaeUnread.lastConversation=convo;
 }
 const now=Date.now(),toMark=[],currentUser=userId();
 for(const m of data.messages){
  if(m.convo!==convo||m.authorId===currentUser||m.deletedAt||m.pending||
     artaeUnread.seen.has(m.id)||artaeUnread.inFlight.has(m.id))continue;
  const el=document.getElementById(m.id);
  if(!el||!scroller.contains(el)||!artaeVisibleMessage(el,scroller)){
   artaeUnread.firstVisible.delete(m.id);continue;
  }
  if(!artaeUnread.firstVisible.has(m.id))artaeUnread.firstVisible.set(m.id,now);
  if(now-artaeUnread.firstVisible.get(m.id)>=550&&toMark.length<100)toMark.push(m.id);
 }
 if(toMark.length&&!artaeUnread.writeBusy)artaeSendRead(convo,toMark);
}
async function artaeSendRead(target,ids){
 artaeUnread.writeBusy=true;
 ids.forEach(id=>artaeUnread.inFlight.add(id));
 try{
  const response=await fetch('/.netlify/functions/sync',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'markRead',convo:target,ids})
  });
  if(!response.ok)throw Error('Read receipt HTTP '+response.status);
  ids.forEach(id=>artaeUnread.seen.add(id));
  artaeUnread.lastFetch=0;
  artaeFetchStats();
 }catch(error){console.warn('Read receipt:',error.message)}
 finally{ids.forEach(id=>artaeUnread.inFlight.delete(id));artaeUnread.writeBusy=false}
}
// The main app may replace just #msgscroll during background sync.
// Read the current DOM without rerendering and without replacing the composer.
setInterval(()=>{
 if(typeof syncReady==='undefined'||!syncReady||document.hidden)return;
 if(Date.now()-artaeUnread.lastFetch>12000)artaeFetchStats();
 artaeDecorateCounts();
 artaeScanReadMessages();
},650);
