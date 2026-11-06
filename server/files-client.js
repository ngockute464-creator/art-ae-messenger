// Project file explorer: no credentials or Yandex URLs exposed to the browser.
let explorer={project:null,path:'',items:[],loading:false,error:'',hasMore:false};
let explorerRequest=0;
let explorerUploading=null;
let explorerDeleting=false;
let explorerPolling=false;
const explorerLimit=3*1024*1024;
async function explorerApi(action,params){
 const api='/.netlify/functions/files-explorer';
 const options={credentials:'same-origin',cache:'no-store'};
 let endpoint=api;
 if(action==='list')endpoint+='?'+new URLSearchParams({action,project:params.project,path:params.path});
 else {options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify({action,...params})}
 const result=await fetch(endpoint,options);
 let payload={};try{payload=await result.json()}catch{}
 if(!result.ok)throw Error(payload.error||'Ошибка файлового проводника');
 return payload;
}
function openExplorer(path=''){
 if(!project)return;
 if(window.innerWidth>1180){
  railCollapsed=false;railTab='files';
  explorerLoad(path);saveWorkplace();return;
 }
 rememberResourceOrigin();
 stopRealtime();view='files';openMenu=null;profileMenuOpen=false;
 explorerLoad(path);
 history.replaceState({view:'files'},'',location.pathname+location.search+'#files');
}
async function explorerLoad(path=''){
 const seq=++explorerRequest,id=project;
 // Begin preparing the DOCX editor immediately, without waiting for the file-list API.
 // Optional editor preparation is scheduled after the file list is rendered.
 explorer={project:id,path,items:[],loading:true,error:'',hasMore:false};
 if(view==='files'||railFileVisible())render();
 try{
  const results=await explorerApi('list',{project:id,path});
  if(seq!==explorerRequest||id!==project)return;
  explorer={project:id,path,items:results.items||[],loading:false,error:'',hasMore:!!results.hasMore};
 }catch(error){
  if(seq!==explorerRequest||id!==project)return;
  explorer={...explorer,loading:false,error:String(error.message||error)};
 }
 if(view==='files'||railFileVisible()){render();if(view==='files'){const scroll=workspaceState?.scroll||0;requestAnimationFrame(()=>{const pane=root.querySelector('.explorerPane');if(pane&&view==='files')pane.scrollTop=scroll})}}
 // Optional editor must never prevent file listing.
 if(id&&id===project&&!explorer.error){
  setTimeout(()=>{try{window.ARTAE_OFFICE_PREWARM?.()}catch(error){console.warn('DOCX warm-up:',error)}},750);
  setTimeout(()=>{try{window.ARTAE_OFFICE_PREWARM_XLSX?.()}catch(error){console.warn('XLSX warm-up:',error)}},2500);
 }
}
// Silent polling while the explorer is visible; never interrupts uploads or documents.
async function explorerCheckChanges(){
 if(explorerPolling||explorerUploading||explorerDeleting||document.hidden||!project||
   explorer.loading||explorer.error||explorer.project!==project||
   !(view==='files'||railFileVisible())||
   document.querySelector('dialog[open],.artaeOfficeOverlay'))return;
 const id=project,path=explorer.path,seq=explorerRequest;
 explorerPolling=true;
 try{
  const result=await explorerApi('list',{project:id,path});
  if(seq!==explorerRequest||id!==project||path!==explorer.path||
     explorerUploading||explorerDeleting||document.hidden||
     !(view==='files'||railFileVisible()))return;
  const items=result.items||[];
  const signature=xs=>JSON.stringify(xs.map(x=>[x.path,x.type,x.size,x.modified]));
  if(signature(items)!==signature(explorer.items)||!!result.hasMore!==explorer.hasMore){
   explorer={...explorer,items,hasMore:!!result.hasMore};
   const old=root.querySelector('.explorerPane');
   const scroll=old?.scrollTop||0;
   render();
   const pane=root.querySelector('.explorerPane');
   if(pane)pane.scrollTop=scroll;
  }
  if(!result.hasMore)void explorerReconcileMissing(items,id,path);
 }catch(error){console.warn('File auto-refresh:',error)}
 finally{explorerPolling=false}
}
setInterval(()=>{void explorerCheckChanges()},20000);
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden)void explorerCheckChanges();
});
window.addEventListener('focus',()=>{void explorerCheckChanges()});

async function explorerDelete(path,name){
 if(!path||!name||explorerDeleting||explorerUploading)return;
 if(!confirm('Удалить файл «'+name+'»?'))return;
 const id=project,folder=explorer.path;
 explorerDeleting=true;
 try{
  await explorerApi('delete',{project:id,path});
  await refreshPins();
  if(id===project&&folder===explorer.path&&(view==='files'||railFileVisible()))await explorerLoad(folder);
 }catch(error){alert(error.message||'Не удалось удалить файл')}
 finally{explorerDeleting=false}
}
async function explorerReconcileMissing(items,id,folder){
 const live=new Set(items.map(x=>x.path));
 const pins=data.pins.filter(x=>x.project===id&&x.kind==='file'&&
  x.item.split('/').slice(0,-1).join('/')===folder&&!live.has(x.item));
 for(const pin of pins.slice(0,10)){
  if(document.hidden||id!==project||explorer.path!==folder)return;
  try{
   const r=await pinsRequest('verifyMissing',{id:pin.id});
   if(r.removed)await refreshPins();
  }catch(e){console.warn('Pin verification:',e)}
 }
}
async function explorerMkdir(){
 const name=prompt('Название новой папки');
 if(name===null)return;
 const value=name.trim();if(!value)return;
 if(/[\\/:*?"<>|\x00-\x1f]/.test(value)||value==='.'||value==='..'||value.endsWith('.'))return alert('Недопустимое имя папки');
 const id=project,path=explorer.path;
 try{await explorerApi('mkdir',{project:id,path,name:value});if(id===project&&(view==='files'||railFileVisible()))explorerLoad(path)}
 catch(error){alert(error.message||'Не удалось создать папку')}
}

function explorerUploadUpdate(){
 const pane=root.querySelector('.explorerUploadProgress');
 if(!pane||!explorerUploading)return;
 const percent=explorerUploading.percent;
 const bar=pane.querySelector('progress');if(bar){bar.value=percent;bar.removeAttribute('aria-busy')}
 const msg=pane.querySelector('.explorerUploadLabel');
 if(msg)msg.textContent=explorerUploading.processing?'Сохраняем файл…':('Загрузка файла: '+percent+'%');
}
function explorerSendUpload(file,id,path,overwrite){
 return new Promise((resolve,reject)=>{
  const url='/.netlify/functions/files-explorer?'+new URLSearchParams({action:'upload',project:id,path,name:file.name,overwrite:overwrite?'1':'0'});
  const xhr=new XMLHttpRequest();xhr.open('POST',url,true);
  xhr.withCredentials=true;xhr.setRequestHeader('Content-Type','application/octet-stream');
  xhr.upload.onprogress=event=>{
   if(!event.lengthComputable||!explorerUploading)return;
   explorerUploading.percent=Math.min(100,Math.round(100*event.loaded/event.total));
   explorerUploadUpdate();
  };
  xhr.upload.onload=()=>{if(explorerUploading){explorerUploading.processing=true;explorerUploading.percent=100;explorerUploadUpdate()}};
  xhr.onerror=()=>reject(Object.assign(Error('Ошибка соединения при загрузке файла'),{status:0}));
  xhr.onabort=()=>reject(Object.assign(Error('Загрузка отменена'),{status:0}));
  xhr.ontimeout=()=>reject(Object.assign(Error('Превышено время ожидания'),{status:0}));
  xhr.onload=()=>{
   let payload={};try{payload=JSON.parse(xhr.responseText)}catch{}
   if(xhr.status<200||xhr.status>=300)reject(Object.assign(Error(payload.error||'Не удалось загрузить файл (HTTP '+xhr.status+')'),{status:xhr.status}));
   else resolve(payload);
  };
  xhr.send(file);
 });
}
async function explorerUpload(file){
 if(!file||explorerUploading)return;
 if(file.size>explorerLimit){alert('Максимальный размер файла — 3 МБ');return}
 const id=project,path=explorer.path;
 const existing=explorer.project===id&&explorer.path===path&&explorer.items.some(x=>x.type==='file'&&x.name===file.name);
 let overwrite=existing;
 if(existing&&!confirm('Файл «'+file.name+'» уже существует. Заменить его?'))return;
 explorerUploading={project:id,path,percent:0,processing:false};
 if(view==='files'||railFileVisible())render();
 explorerUploadUpdate();
 try{
  try{await explorerSendUpload(file,id,path,overwrite)}
  catch(error){
   if(error.status!==409||overwrite)throw error;
   if(!confirm('Файл «'+file.name+'» уже существует. Заменить его?'))return;
   overwrite=true;
   if(explorerUploading){explorerUploading.percent=0;explorerUploading.processing=false;explorerUploadUpdate()}
   await explorerSendUpload(file,id,path,true);
  }
  if(id===project&&(view==='files'||railFileVisible())&&explorer.path===path)await explorerLoad(path);
 }catch(error){alert(error.message||'Не удалось загрузить файл')}
 finally{explorerUploading=null;if(view==='files'||railFileVisible())render()}
}

async function explorerFileBlob(path){
 const url='/.netlify/functions/files-explorer?'+new URLSearchParams({action:'download',project,path});
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});
 if(!r.ok){let data={};try{data=await r.json()}catch{};throw Error(data.error||'Не удалось получить файл')}
 const blob=await r.blob();
 if(blob.size>explorerLimit)throw Error('Файл превышает лимит 3 МБ');
 return blob;
}
async function explorerDownload(path,name){
 try{
  const blob=await explorerFileBlob(path);
  const href=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=href;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(href),30000);
 }catch(e){alert(e.message||'Не удалось скачать файл')}
}
function explorerKind(name,mime){
 const ext=(name.split('.').pop()||'').toLowerCase(),type=(mime||'').toLowerCase();
 if(['png','jpg','jpeg','gif','webp','bmp','svg','avif'].includes(ext)||type.startsWith('image/'))return 'image';
 if(ext==='pdf'||type==='application/pdf')return 'pdf';
 if(ext==='docx'||type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')return 'docx';
 if(['txt','md','csv','json','xml','log','js','css','html','yml','yaml','ts'].includes(ext)||type.startsWith('text/'))return 'text';
 if(['mp3','m4a','wav','ogg','oga','aac','flac'].includes(ext)||type.startsWith('audio/'))return 'audio';
 if(['mp4','webm','mov','m4v','ogv'].includes(ext)||type.startsWith('video/'))return 'video';
 return 'unknown';
}

async function explorerDocxText(blob){
 // Read only document.xml from an OOXML ZIP. No remote converters or executable content.
 const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
  if(view.getUint32(i,true)===0x06054b50){end=i;break}
 }
 if(end<0)throw Error('Файл DOCX повреждён');
 const count=view.getUint16(end+10,true),central=view.getUint32(end+16,true);
 let pos=central,match=null;
 for(let n=0;n<count&&n<10000;n++){
  if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)throw Error('Ошибка структуры DOCX');
  const method=view.getUint16(pos+10,true),compressed=view.getUint32(pos+20,true),uncompressed=view.getUint32(pos+24,true);
  const len=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),offset=view.getUint32(pos+42,true);
  if(pos+46+len+extra+comment>bytes.length)throw Error('Ошибка структуры DOCX');
  const name=new TextDecoder().decode(bytes.subarray(pos+46,pos+46+len));
  if(name==='word/document.xml'){match={method,compressed,uncompressed,offset};break}
  pos+=46+len+extra+comment;
 }
 if(!match)throw Error('Текст документа не найден');
 if(match.uncompressed>8*1024*1024||match.compressed>explorerLimit)throw Error('DOCX слишком велик для просмотра');
 const off=match.offset;
 if(off+30>bytes.length||view.getUint32(off,true)!==0x04034b50)throw Error('Ошибка содержимого DOCX');
 const start=off+30+view.getUint16(off+26,true)+view.getUint16(off+28,true);
 if(start+match.compressed>bytes.length)throw Error('Файл DOCX обрезан');
 let result;
 if(match.method===0)result=bytes.subarray(start,start+match.compressed);
 else if(match.method===8){
  if(!('DecompressionStream' in window))throw Error('Браузер не поддерживает просмотр DOCX');
  const stream=new Blob([bytes.subarray(start,start+match.compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader=stream.getReader(),parts=[];let size=0;
  try{
   while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>8*1024*1024)throw Error('DOCX слишком велик для просмотра');
    parts.push(value)}
  }finally{reader.releaseLock()}
  result=new Uint8Array(size);let cursor=0;
  for(const part of parts){result.set(part,cursor);cursor+=part.length}
 }else throw Error('Неподдерживаемый формат сжатия DOCX');
 const xml=new DOMParser().parseFromString(new TextDecoder().decode(result),'application/xml');
 if(xml.querySelector('parsererror'))throw Error('Ошибка текста DOCX');
 const paragraphs=Array.from(xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p'));
 const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 return paragraphs.map(p=>Array.from(p.getElementsByTagNameNS(ns,'t')).map(n=>n.textContent).join('')).join('\n');
}
function explorerZoomableImage(media,body,bar){
 const viewport=document.createElement('div');viewport.className='fileImageViewport';
 const zoomTools=document.createElement('div');zoomTools.className='fileZoomTools';
 const down=document.createElement('button'),reset=document.createElement('button'),up=document.createElement('button');
 for(const [el,label,title] of [[down,'−','Уменьшить'],[reset,'100%','Сбросить масштаб'],[up,'+','Увеличить']]){
  el.type='button';el.className='btn small';el.textContent=label;el.title=title;zoomTools.append(el)}
 bar.insertBefore(zoomTools,bar.lastElementChild);
 viewport.append(media);body.append(viewport);
 let scale=1,x=0,y=0,dragging=false,lastX=0,lastY=0;
 const apply=()=>{scale=Math.max(1,Math.min(8,scale));if(scale===1){x=0;y=0}
  media.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')';reset.textContent=Math.round(scale*100)+'%';
  media.style.cursor=scale>1?(dragging?'grabbing':'grab'):'zoom-in'};
 const zoom=(factor,px,py)=>{const old=scale;scale=Math.max(1,Math.min(8,scale*factor));if(scale!==old&&scale>1){
  const bounds=viewport.getBoundingClientRect(),dx=px-(bounds.left+bounds.width/2),dy=py-(bounds.top+bounds.height/2);
  x=(x-dx)*(scale/old)+dx;y=(y-dy)*(scale/old)+dy}apply()};
 viewport.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2,e.clientX,e.clientY)},{passive:false});
 viewport.addEventListener('pointerdown',e=>{if(scale===1)return;dragging=true;lastX=e.clientX;lastY=e.clientY;viewport.setPointerCapture(e.pointerId);apply()});
 viewport.addEventListener('pointermove',e=>{if(!dragging)return;x+=e.clientX-lastX;y+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;apply()});
 const stop=()=>{dragging=false;apply()};viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);
 viewport.addEventListener('dblclick',()=>{scale=1;apply()});
 up.addEventListener('click',()=>{const b=viewport.getBoundingClientRect();zoom(1.25,b.left+b.width/2,b.top+b.height/2)});
 down.addEventListener('click',()=>{const b=viewport.getBoundingClientRect();zoom(.8,b.left+b.width/2,b.top+b.height/2)});
 reset.addEventListener('click',()=>{scale=1;apply()});
 apply();
}

async function explorerPreview(path,name,mime){
 if(/\.(docx|xlsx)$/i.test(name)){
  if(typeof window.ARTAE_OFFICE_PREVIEW!=='function'){
   alert('Office-просмотр не загрузился. Обновите страницу и попробуйте снова.');
   return;
  }
  try{return await window.ARTAE_OFFICE_PREVIEW(path,name,explorer.project||project)}
  catch(error){console.error('Office preview',error);alert('Не удалось открыть просмотр: '+String(error?.message||error))}
 }
 const kind=explorerKind(name,mime);
 if(kind==='unknown')return alert('Предпросмотр этого формата пока не поддерживается. Используйте «Скачать».');
 const dialog=document.createElement('dialog');
 dialog.className='filePreviewDialog';
 dialog.setAttribute('aria-label','Просмотр файла '+name);
 dialog.innerHTML='<div class="filePreviewHeader"><strong class="filePreviewTitle"></strong><button class="btn small" type="button" aria-label="Закрыть просмотр">✕</button></div><div class="filePreviewBody">Загрузка…</div>';
 dialog.querySelector('.filePreviewTitle').textContent=name;
 const body=dialog.querySelector('.filePreviewBody');
 const close=dialog.querySelector('button');
 let objectUrl=null;
 function dispose(){if(objectUrl)URL.revokeObjectURL(objectUrl);dialog.remove()}
 dialog.addEventListener('close',dispose,{once:true});
 close.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
 document.body.append(dialog);dialog.showModal();
 try{
  const blob=await explorerFileBlob(path);
  if(!dialog.open)return;
  body.replaceChildren();
  if(kind==='text'||kind==='docx'){
   const pre=document.createElement('pre');pre.className='filePreviewText';
   if(kind==='docx'){
    const note=document.createElement('p');note.className='filePreviewNotice';note.textContent='Текстовый просмотр DOCX: оформление и изображения могут отличаться от Word.';body.append(note);
    pre.textContent=await explorerDocxText(blob);
   }else pre.textContent=await blob.text();
   body.append(pre);
  }else{
   const effective=kind==='pdf'?'application/pdf':kind==='image'?(mime||'image/png'):kind==='audio'?(mime||'audio/mpeg'):(mime||'video/mp4');
   objectUrl=URL.createObjectURL(new Blob([blob],{type:effective}));
   const media=document.createElement(kind==='pdf'?'object':kind==='image'?'img':kind);
   media.className='filePreviewMedia';
   if(kind==='pdf'){media.data=objectUrl;media.type='application/pdf';media.setAttribute('aria-label','PDF '+name);
    const fallback=document.createElement('p');fallback.textContent='Если браузер не показывает PDF, используйте кнопку «Скачать» рядом с файлом.';media.append(fallback);
   }else media.src=objectUrl;
   if(kind==='audio'||kind==='video')media.controls=true;
   if(kind==='image')media.alt=name;
   if(kind==='image')explorerZoomableImage(media,body,dialog.querySelector('.filePreviewHeader'));
   else body.append(media);
  }
 }catch(e){if(dialog.open)body.textContent=e.message||'Не удалось показать файл'}
}

document.addEventListener('change',e=>{
 if(e.target?.id==='explorerUpload'&&root.contains(e.target)){
  const file=e.target.files?.[0];e.target.value='';
  if(file)void explorerUpload(file);
 }
},true);

// Native details menus: only one open at a time; click outside or Escape closes it.
document.addEventListener('click',event=>{
 const menus=document.querySelectorAll('.fileMoreMenu[open]');
 const clicked=event.target.closest?.('.fileMoreMenu');
 for(const menu of menus)if(menu!==clicked||event.target.closest?.('.fileMorePanel [data-act]'))menu.open=false;
});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape')for(const menu of document.querySelectorAll('.fileMoreMenu[open]'))menu.open=false;
});

function filesView(){
 if(explorer.project!==project)return '<section class="pane"><p class="help">Загрузка…</p></section>';
 const back=explorer.path?'<button type="button" class="btn small" data-act="filesUp">↑ На уровень выше</button>':'';
 const breadcrumbs=explorer.path?explorer.path.split('/').map(s=>' / '+esc(s)).join(''):'';
 const list=explorer.items.map(item=>{
  const isFolder=item.type==='folder',size=isFolder?'Папка':item.size==null?'':item.size<1024?item.size+' Б':item.size<1048576?(item.size/1024).toFixed(1)+' КБ':(item.size/1048576).toFixed(1)+' МБ';

  if(isFolder)return '<button type="button" class="fileEntry" data-act="filesOpen" data-path="'+esc(item.path)+'"><span class="fileGlyph" aria-hidden="true">📁</span><span class="fileEntryName">'+esc(item.name)+'</span><span class="fileEntryMeta">'+esc(size)+'</span><span aria-hidden="true">›</span></button>';
  const canOffice=/\.(docx|xlsx)$/i.test(item.name);
  const pinned=data.pins.some(p=>p.project===project&&p.kind==='file'&&p.scope==='project'&&p.scopeId===project&&p.item===item.path);
  const path=esc(item.path),name=esc(item.name);
  const editAction=canOffice?'<button type="button" data-act="officeEdit" data-project="'+esc(String(explorer.project))+'" data-path="'+path+'" data-name="'+name+'" role="menuitem">Редактировать</button>':'';
  const menu='<details class="fileMoreMenu"><summary title="Действия с файлом" aria-label="Действия с файлом '+name+'">⋯</summary><div class="fileMorePanel" role="menu" aria-label="Действия с файлом">'+editAction+'<button type="button" data-act="filesDelete" data-path="'+path+'" data-name="'+name+'" role="menuitem" class="fileMoreDanger">Удалить</button></div></details>';
  return '<div class="fileEntry">'+menu+'<button type="button" class="fileEntryNameAction" data-act="filesPreview" data-path="'+path+'" data-name="'+name+'" data-mime="'+esc(item.mimeType||'')+'" title="Просмотреть файл">'+name+'</button><span class="fileEntryMeta">'+esc(size)+'</span><button type="button" class="fileActionBtn" data-act="filesDownload" data-path="'+path+'" data-name="'+name+'" title="Скачать" aria-label="Скачать '+name+'">↓</button><button type="button" class="fileActionBtn filePinBtn '+(pinned?'is-pinned':'is-unpinned')+'" data-act="pinFile" data-path="'+path+'" title="'+(pinned?'Открепить файл':'Закрепить в проекте')+'" aria-label="'+(pinned?'Открепить ':'Закрепить ')+name+'" aria-pressed="'+(pinned?'true':'false')+'"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M16 9V4l1-1V2H7v1l1 1v5l-2 2v2h5v9h2v-9h5v-2l-2-2z"/></svg></button></div>';

 }).join('');
 const upload=explorerUploading&&explorerUploading.project===explorer.project&&explorerUploading.path===explorer.path;
 const uploadStatus=upload?'<div class="explorerUploadProgress" role="status"><span class="explorerUploadLabel">Загрузка файла: '+explorerUploading.percent+'%</span><progress max="100" value="'+explorerUploading.percent+'" style="width:100%;display:block;margin-top:6px"></progress></div>':'';
 const body=explorer.loading?'<div class="empty">Загрузка…</div>':explorer.error?'<div class="empty"><p>'+esc(explorer.error)+'</p><button class="btn" data-act="filesReload">Повторить</button></div>':list||'<div class="empty"><h3>Папка пуста</h3><p>Загрузите файл или создайте папку.</p></div>';
 return '<section class="pane explorerPane"><div class="explorerToolbar"><div><h2>Файлы проекта</h2><p class="help explorerPath">'+esc(cp()?.name||'Проект')+breadcrumbs+'</p></div><div class="explorerActions"><input id="explorerUpload" type="file" hidden><button type="button" class="btn small" data-act="filesUpload"'+(explorer.loading||explorerUploading?' disabled':'')+'>↑ Загрузить</button><button type="button" class="btn small primary" data-act="filesMkdir"'+(explorer.loading?' disabled':'')+'>＋ Папка</button></div></div>'+uploadStatus+back+'<div class="explorerList">'+body+'</div>'+(explorer.hasMore?'<p class="help">Показана часть элементов папки.</p>':'')+'</section>';
}

async function trashProject(id){
 const p=data.projects.find(x=>x.id===id);
 if(!p||window.ARTAE_AUTH?.getUser()?.role!=='admin')return;
 const typed=prompt('Чтобы удалить проект «'+p.name+'» из списка у всех пользователей, введите его точное название. Переписка и файлы сохранятся для восстановления.');
 if(typed===null)return;
 if(typed!==p.name)return alert('Название не совпадает. Проект не удалён.');
 if(!confirm('Скрыть проект «'+p.name+'» и все его разговоры? Восстановление доступно администратору.'))return;
 try{
  await syncApi('deleteProject',{id,confirmName:typed});
  modal=null;data.projects=data.projects.filter(x=>x.id!==id);
  const ids=new Set(data.convos.filter(c=>c.project===id).map(c=>c.id));
  data.convos=data.convos.filter(c=>c.project!==id);
  data.messages=data.messages.filter(m=>!ids.has(m.convo));
  if(project===id){project=data.projects[0]?.id||null;convo=null;view=project?'conversations':'projects';stopRealtime();}
  render();await syncOverview();
 }catch(e){alert(e.message||'Не удалось удалить проект')}
}
async function restoreProjectPicker(){
 if(window.ARTAE_AUTH?.getUser()?.role!=='admin')return;
 try{
  const r=await fetch('/.netlify/functions/sync?action=deletedProjects',{credentials:'same-origin',cache:'no-store'});
  const value=await r.json();if(!r.ok)throw Error(value.error||'Ошибка запроса');
  const projects=value.projects||[];
  if(!projects.length)return alert('Удалённых проектов нет.');
  const choice=prompt('Восстановить проект. Введите номер из списка:\n'+projects.map((p,i)=>(i+1)+'. '+p.name).join('\n'));
  if(choice===null)return;
  if(!/^[1-9][0-9]*$/.test(choice)||Number(choice)>projects.length)return alert('Неверный номер.');
  const p=projects[Number(choice)-1];
  if(!confirm('Восстановить «'+p.name+'» вместе с разговорами?'))return;
  await syncApi('restoreProject',{id:p.id});
  await syncOverview();render();
 }catch(e){alert(e.message||'Не удалось восстановить проект')}
}
