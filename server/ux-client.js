// ART-AE desktop context rail, shared pins and per-device workspace restoration.
const WORKSPACE_KEY='artae_workspace_v2_'+userId();
let workspaceState={};
try{workspaceState=JSON.parse(localStorage.getItem(WORKSPACE_KEY)||'{}')||{}}catch{}
let railFiles=[],railProject=null,railLoading=false;
let railCollapsed=!!workspaceState.railCollapsed;
let railWidth=Math.max(230,Math.min(410,Number(workspaceState.railWidth)||280));
document.documentElement.style.setProperty('--rail-width',railWidth+'px');
let pinsLoading=false,pinsUnavailable=false,pinsVersion='';
function saveWorkplace(){
 try{
  const pane=root.querySelector('.explorerPane');
  const old=workspaceState;
  workspaceState={...old,project:project||null,convo:convo||null,view,
   path:view==='files'?explorer.path:(old.path||''),
   scroll:view==='files'?(pane?.scrollTop||0):(old.scroll||0),
   railCollapsed,railWidth};
  localStorage.setItem(WORKSPACE_KEY,JSON.stringify(workspaceState));
 }catch{}
}
function restoreWorkplace(){
 const s=workspaceState;
 if(!s||!data.projects.some(p=>p.id===s.project))return;
 project=s.project;
 const valid=data.convos.some(c=>c.id===s.convo&&c.project===project);
 convo=valid?s.convo:null;
 view=['chat','files','conversations','projectpins','pins','projects'].includes(s.view)?s.view:'conversations';
 if(view==='chat'&&!convo)view='conversations';
 if(view==='pins'&&!convo)view='conversations';
 if(view==='files')queueMicrotask(()=>{if(view==='files')explorerLoad(s.path||'')});
 if(view==='chat'&&convo)queueMicrotask(()=>{syncMessages(true);connectRealtime(convo)});
}
async function pinsRequest(action,params={},get=false){
 const base='/.netlify/functions/pins';
 const options={credentials:'same-origin',cache:'no-store'};
 const target=get?base+'?'+new URLSearchParams(params):base;
 if(!get){options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify({action,...params})}
 const r=await fetch(target,options);
 let body={};try{body=await r.json()}catch{}
 if(!r.ok)throw Error(body.error||'Ошибка закреплений');
 return body;
}
async function refreshPins(){
 if(!project||pinsLoading)return;
 const current=project;pinsLoading=true;
 try{
  const r=await pinsRequest('',{project:current},true);
  if(project!==current)return;
  pinsUnavailable=false;
  const newPins=r.pins||[];
  const snapshot=JSON.stringify(newPins);
  if(snapshot!==pinsVersion){
   pinsVersion=snapshot;data.pins=newPins;
   if(!modal&&!editing&&document.activeElement?.id!=='draft')render();
  }
 }catch(e){pinsUnavailable=true;console.warn('Shared pins unavailable:',e.message)}
 finally{pinsLoading=false}
}
async function toggleRemotePin(kind,item,scope,scopeId){
 if(!project)return;
 try{
  await pinsRequest('toggle',{project,kind,item,scope,scopeId});
  await refreshPins();
 }catch(e){alert(e.message||'Не удалось изменить закрепление')}
}
async function removeRemotePin(id){
 try{await pinsRequest('remove',{id});await refreshPins()}
 catch(e){alert(e.message||'Не удалось открепить')}
}
async function updateRemoteNote(id,note){
 try{await pinsRequest('note',{id,note});await refreshPins()}
 catch(e){alert(e.message||'Не удалось сохранить примечание')}
}
async function refreshRailFiles(){
 if(!project||railLoading)return;
 const id=project;railProject=id;railLoading=true;
 try{
  const result=await explorerApi('list',{project:id,path:''});
  if(id!==project)return;
  railFiles=(result.items||[]).filter(x=>x.type==='file').sort((a,b)=>String(b.modified||'').localeCompare(String(a.modified||''))).slice(0,7);
  if(view==='chat'&&!modal&&!editing&&document.activeElement?.id!=='draft')render();
 }catch(e){console.warn('Project files summary:',e.message);railFiles=[]}
 finally{railLoading=false}
}
function railPins(scope){
 const id=scope==='project'?project:convo;
 return data.pins.filter(p=>p.scope===scope&&p.scopeId===id).slice(0,7);
}
function railPanel(title,icon,items,scope){
 const collapsed=!!workspaceState['collapsed_'+scope];
 const head='<button type="button" class="railSectionTitle" data-act="railSection" data-scope="'+scope+'" title="'+(collapsed?'Развернуть':'Свернуть')+'"><span>'+icon+' '+title+'</span><span aria-hidden="true">'+(collapsed?'▸':'▾')+'</span></button>';
 return '<section class="railSection">'+head+(collapsed?'':'<div class="railSectionBody">'+(items||'<p class="railEmpty">Пока пусто</p>')+'</div>')+'</section>';
}
function desktopRail(){
 if(view!=='chat'||!project||!convo)return '';
 const files=railProject===project?railFiles:[];
 const pinWarning=pinsUnavailable?'<p class="railEmpty" role="status">Общие закрепления пока недоступны: проверьте таблицу PostgreSQL.</p>':'';
 const fileRows=files.map(f=>'<div class="railItem"><button type="button" class="railItemName" data-act="filesPreview" data-path="'+esc(f.path)+'" data-name="'+esc(f.name)+'" data-mime="'+esc(f.mimeType||'')+'" title="Посмотреть файл">'+esc(f.name)+'</button><button type="button" class="railMini" data-act="filesDownload" data-path="'+esc(f.path)+'" data-name="'+esc(f.name)+'" aria-label="Скачать '+esc(f.name)+'">↓</button></div>').join('');
 const cards=scope=>railPins(scope).map(p=>{
  const content=p.previewText||p.item;
  const act=p.kind==='file'?'filesPreview':'railJumpPin';
  return '<button class="railPinnedItem" type="button" data-act="'+act+'" data-id="'+esc(p.item)+'" data-convo="'+esc(p.convoId||'')+'" data-path="'+esc(p.item)+'" data-name="'+esc(p.item.split('/').pop())+'">'+(p.kind==='file'?'📄 ':'📌 ')+esc(content.slice(0,110))+'</button>';
 }).join('');
 return '<div class="desktopRailGrip" data-act="railResize" role="separator" aria-label="Изменить ширину правой панели"></div><aside class="desktopRail"><div class="railTop"><strong>Материалы</strong><button class="railMini" type="button" data-act="railCollapse" title="Свернуть правую панель">☷</button></div>'+
 (railCollapsed?'':pinWarning+railPanel('Файлы проекта','📁',fileRows+'<button type="button" class="railAll" data-act="filesHome">Все файлы</button>','files')+
 railPanel('Закрепления проекта','📌',cards('project')+'<button type="button" class="railAll" data-act="pins" data-scope="project">Все закрепления</button>','project')+
 railPanel('Закрепления разговора','📌',cards('convo')+'<button type="button" class="railAll" data-act="pins" data-scope="convo">Все закрепления</button>','convo'))+
 '</aside>';
}
async function railJumpPin(item,targetConvo){
 if(!targetConvo)return alert('Исходный разговор недоступен');
 const c=data.convos.find(x=>x.id===targetConvo);if(!c)return alert('Разговор удалён');
 project=c.project;convo=c.id;view='chat';highlightId=item;render();saveWorkplace();
 await syncMessages(true);
 if(convo===c.id){render();requestAnimationFrame(()=>document.getElementById(item)?.scrollIntoView({block:'center'}))}
}
root.addEventListener('scroll',e=>{
 if(e.target?.classList?.contains('explorerPane'))saveWorkplace();
},true);
window.addEventListener('pagehide',saveWorkplace);
root.addEventListener('click',()=>queueMicrotask(()=>{
 saveWorkplace();
 if(project&&railProject!==project)refreshRailFiles();
}));
root.addEventListener('pointerdown',e=>{
 const grip=e.target.closest('.desktopRailGrip');
 if(!grip||window.innerWidth<1180)return;
 e.preventDefault();
 let active=true;
 const move=ev=>{if(!active)return;railWidth=Math.max(230,Math.min(410,window.innerWidth-ev.clientX));document.documentElement.style.setProperty('--rail-width',railWidth+'px')};
 const stop=()=>{active=false;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);saveWorkplace()};
 window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});
});
setInterval(()=>{if(syncReady&&!document.hidden)refreshPins()},7000);
