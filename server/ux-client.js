// ART-AE desktop context rail, shared pins and per-device workspace restoration.
const WORKSPACE_KEY='artae_workspace_v2_'+userId();
let workspaceState={};
try{workspaceState=JSON.parse(localStorage.getItem(WORKSPACE_KEY)||'{}')||{}}catch{}
let railProject=null,railLoading=false;
let railTab=workspaceState.railTab||'files';
let railCollapsed=!!workspaceState.railCollapsed;
let railWidth=workspaceState.railModeVersion===2?Math.max(0,Number(workspaceState.railWidth)||0):0;
if(railWidth)document.documentElement.style.setProperty('--rail-width',railWidth+'px');
let pinsLoading=false,pinsUnavailable=false,pinsVersion='';
let resourceReturn=null;
function rememberResourceOrigin(){
 if(view==='files'||view==='pins'||view==='projectpins')return;
 resourceReturn={view:view==='chat'?'chat':'conversations',project,convo};
}
function returnFromResources(){
 const target=resourceReturn;
 resourceReturn=null;
 if(target?.project===project&&target.view==='chat'&&target.convo&&data.convos.some(c=>c.id===target.convo&&c.project===project)){
  convo=target.convo;switchView('chat');syncMessages(true);connectRealtime(convo);
 }else switchView('conversations');
}

function saveWorkplace(){
 try{
  const pane=root.querySelector('.explorerPane');
  const old=workspaceState;
  workspaceState={...old,project:project||null,convo:convo||null,view,
   path:view==='files'?explorer.path:(old.path||''),
   scroll:view==='files'?(pane?.scrollTop||0):(old.scroll||0),
   railCollapsed,railWidth,railTab,railModeVersion:2};
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
 catch(e){alert(e.message||'Не удалось сохранить примечание');throw e}
}
async function refreshRailFiles(){
 if(!project)return;
 const id=project;
 if(explorer.project===id&&(explorer.loading||!explorer.error))return;
 railProject=id;
 railLoading=true;
 try{await explorerLoad('')}
 catch(e){console.warn('Project files:',e.message)}
 finally{railLoading=false}
}
function railPins(scope){
 const id=scope==='project'?project:convo;
 if(scope==='convo'&&(!id||!data.convos.some(c=>c.id===id&&c.project===project)))return [];
 return data.pins.filter(p=>p.project===project&&p.scope===scope&&p.scopeId===id);
}

function visibleRailTabs(){
 const tabs=['files'];
 if(railPins('project').length)tabs.push('project');
 if(railPins('convo').length)tabs.push('convo');
 return tabs;
}
function activeRailTab(){
 const available=visibleRailTabs();
 if(!available.includes(railTab))railTab='files';
 return railTab;
}
function railFileVisible(){
 return !!project && view!=='files' && !railCollapsed && activeRailTab()==='files' && window.innerWidth>1180;
}
function railPinRows(scope){
 return railPins(scope).map(p=>{
  const isFile=p.kind==='file',title=p.previewText||p.item;
  const act=isFile?'jumpPinnedFile':'railJumpPin';
  return '<div class="railPinRow"><button type="button" class="railPinnedItem" data-act="'+act+'" data-id="'+esc(p.item)+'" data-convo="'+esc(p.convoId||'')+'" data-path="'+esc(p.item)+'" data-name="'+esc(p.item.split('/').pop())+'" title="'+(isFile?'Открыть файл':'Перейти к сообщению')+'">'+(isFile?'📄 ':'📌 ')+esc(pinTextSummary(title))+'</button><button type="button" class="railMini" data-act="removePin" data-id="'+esc(p.id)+'" title="Открепить" aria-label="Открепить">×</button></div>';
 }).join('');
}
function desktopRail(){
 if(view==='files'||!project)return '';
 // A newly selected project must load its root folder even before a chat is chosen.
 if(activeRailTab()==='files'&&explorer.project!==project)
  queueMicrotask(()=>{if(project&&explorer.project!==project)refreshRailFiles()});
 const tab=activeRailTab(),names={files:'Файлы',project:'Закрепления проекта',convo:'Закрепления разговора'};
 const buttons=visibleRailTabs().map(key=>'<button type="button" role="tab" aria-selected="'+(tab===key)+'" class="railTab'+(tab===key?' selected':'')+'" data-act="railTab" data-tab="'+key+'" title="'+names[key]+'">'+(key==='files'?'📁 ': '📌 ')+names[key]+'</button>').join('');
 const warning=pinsUnavailable?'<p class="railEmpty" role="status">Не удалось загрузить закрепления</p>':'';
 let content='';
 if(tab==='files')content=filesView();
 else content='<div class="railPinsFull">'+railPinRows(tab)+'</div>';
 return '<div class="desktopRailGrip" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Изменить ширину чата и правой колонки"></div><aside class="desktopRail">'+
 '<div class="railTabsBar"><div class="railTabs" role="tablist" aria-label="Материалы проекта">'+buttons+'</div><button type="button" class="railMini railToggle" data-act="railCollapse" title="Свернуть панель" aria-label="Свернуть панель">◧</button></div>'+
 (railCollapsed?'':warning+'<div class="railTabContent" role="tabpanel">'+content+'</div>')+'</aside>';
}
async function railJumpPin(item,targetConvo){
 if(!targetConvo)return alert('Исходный разговор недоступен');
 const c=data.convos.find(x=>x.id===targetConvo);
 if(!c||c.project!==project)return alert('Разговор недоступен');
 const previous=convo;
 if(previous!==c.id)stopRealtime();
 convo=c.id;view='chat';highlightId=item;openMenu=null;
 // A pinned message can predate the incremental sync cursor; load full history
 // when it isn't in the local snapshot.
 if(!data.messages.some(m=>m.id===item&&m.convo===c.id))lastMessageCursor[c.id]=0;
 render();saveWorkplace();
 await syncMessages(true);
 if(convo!==c.id||view!=='chat')return;
 connectRealtime(c.id);
 render();
 requestAnimationFrame(()=>{
  const target=document.getElementById(item);
  if(target)target.scrollIntoView({block:'center'});
  else console.warn('Pinned message not found in loaded conversation',item);
 });
}
function jumpPinnedFile(path){
 if(typeof path!=='string'||!path||path.startsWith('/')||path.includes('\\')||path.includes('//'))
  return alert('Недопустимый путь закреплённого файла');
 const parts=path.split('/');
 if(parts.some(x=>!x||x==='.'||x==='..'))return alert('Недопустимый путь закреплённого файла');
 const folder=parts.slice(0,-1).join('/');
 openExplorer(folder);
 // The file explorer has its own async list renderer; locate the file only
 // after the list returns. Missing files still leave the correct folder open.
 const selectedProject=project;
 const request=explorerRequest;
 const reveal=()=>{
  if(project!==selectedProject||explorerRequest!==request||explorer.path!==folder)return;
  if(explorer.loading){setTimeout(reveal,80);return}
  const file=[...root.querySelectorAll('[data-act="filesPreview"][data-path]')]
   .find(node=>node.dataset.path===path);
  file?.scrollIntoView({block:'center'});
 };
 setTimeout(reveal,0);
}
// Make existing pinned cards navigable without modifying remove/note buttons.
// The main content of a pin jumps to its origin; explicit pin management stays intact.
const originalPinCard=pinCard;
pinCard=function(p){
 const html=originalPinCard(p);
 if(typeof html!=='string')return html;
 const attrs=' data-artae-pin-kind="'+esc(p.kind)+'" data-artae-pin-item="'+esc(p.item)+'" data-artae-pin-convo="'+esc(p.convoId||'')+'"';
 return html.replace(/<([a-z][a-z0-9-]*)\b/i,match=>match+attrs);
};
root.addEventListener('click',event=>{
 if(view!=='pins'&&view!=='projectpins')return;
 const pinElement=event.target.closest('[data-artae-pin-kind]');
 if(!pinElement)return;
 const control=event.target.closest('button,a,input,textarea,select,[contenteditable]');
 const action=control?.dataset?.act||'';
 // A pin's text is navigable; dedicated management actions are not.
 if(control&& !['goMessage','goFile','filesPreview','railJumpPin'].includes(action))return;
 event.preventDefault();event.stopImmediatePropagation();
 if(pinElement.dataset.artaePinKind==='file')jumpPinnedFile(pinElement.dataset.artaePinItem);
 else railJumpPin(pinElement.dataset.artaePinItem,pinElement.dataset.artaePinConvo);
},true);
root.addEventListener('scroll',e=>{
 if(e.target?.classList?.contains('explorerPane'))saveWorkplace();
},true);
window.addEventListener('pagehide',saveWorkplace);
let lastRailProject=null;
root.addEventListener('click',()=>queueMicrotask(()=>{
 saveWorkplace();
 if(project!==lastRailProject){lastRailProject=project;railProject=null;pinsVersion='';data.pins=[];refreshPins();}
 if(project&&explorer.project!==project)refreshRailFiles();
}));
root.addEventListener('pointerdown',e=>{
 const grip=e.target.closest('.desktopRailGrip');
 if(!grip||window.innerWidth<=1180||railCollapsed)return;
 e.preventDefault();
 let active=true;
 const move=ev=>{if(!active)return;const split=root.querySelector('.split');if(!split)return;
  const rect=split.getBoundingClientRect(),conversationWidth=layoutSizes.conversations||250;
  const available=Math.max(560,rect.width-conversationWidth);
  railWidth=Math.round(Math.max(280,Math.min(available-280,rect.right-ev.clientX)));
  document.documentElement.style.setProperty('--rail-width',railWidth+'px');
 };
 const stop=()=>{active=false;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);saveWorkplace()};
 window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});
});
root.addEventListener('keydown',e=>{
 if(e.target?.classList?.contains('desktopRailGrip')&&['ArrowLeft','ArrowRight'].includes(e.key)){
  e.preventDefault();railWidth=Math.max(280,(railWidth||Math.round(window.innerWidth*.32))+(e.key==='ArrowLeft'?20:-20));
  document.documentElement.style.setProperty('--rail-width',railWidth+'px');saveWorkplace();
 }
});

let editorPointerStartedInside=false,editorSelectionReleaseOutside=false;
document.addEventListener('pointerdown',event=>{
 const target=event.target;
 editorPointerStartedInside=event.button===0&&!!target?.closest?.('input,textarea,[contenteditable="true"]')&&!!document.querySelector('[data-act="closeModal"],.modal,.modalOverlay,[role="dialog"]');
 editorSelectionReleaseOutside=false;
},true);
document.addEventListener('pointerup',event=>{
 if(!editorPointerStartedInside)return;
 const target=event.target;
 editorSelectionReleaseOutside=!target?.closest?.('input,textarea,[contenteditable="true"]');
},true);
document.addEventListener('click',event=>{
 if(!editorSelectionReleaseOutside)return;
 editorSelectionReleaseOutside=false;editorPointerStartedInside=false;
 // The click generated by a drag selection must not be mistaken for closing the dialog.
 event.preventDefault();event.stopImmediatePropagation();
},true);

setInterval(()=>{if(syncReady&&!document.hidden)refreshPins()},7000);
