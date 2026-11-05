// Project file explorer: no credentials or Yandex URLs exposed to the browser.
let explorer={project:null,path:'',items:[],loading:false,error:'',hasMore:false};
let explorerRequest=0;
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
 stopRealtime();view='files';openMenu=null;profileMenuOpen=false;
 explorerLoad(path);
 history.replaceState({view:'files'},'',location.pathname+location.search+'#files');
}
async function explorerLoad(path=''){
 const seq=++explorerRequest,id=project;
 explorer={project:id,path,items:[],loading:true,error:'',hasMore:false};
 if(view==='files')render();
 try{
  const results=await explorerApi('list',{project:id,path});
  if(seq!==explorerRequest||id!==project||view!=='files')return;
  explorer={project:id,path,items:results.items||[],loading:false,error:'',hasMore:!!results.hasMore};
 }catch(error){
  if(seq!==explorerRequest||id!==project||view!=='files')return;
  explorer={...explorer,loading:false,error:String(error.message||error)};
 }
 if(view==='files'){render();const scroll=workspaceState?.scroll||0;requestAnimationFrame(()=>{const pane=root.querySelector('.explorerPane');if(pane&&view==='files')pane.scrollTop=scroll})}
}
async function explorerMkdir(){
 const name=prompt('Название новой папки');
 if(name===null)return;
 const value=name.trim();if(!value)return;
 if(/[\\/:*?"<>|\x00-\x1f]/.test(value)||value==='.'||value==='..'||value.endsWith('.'))return alert('Недопустимое имя папки');
 const id=project,path=explorer.path;
 try{await explorerApi('mkdir',{project:id,path,name:value});if(id===project&&view==='files')explorerLoad(path)}
 catch(error){alert(error.message||'Не удалось создать папку')}
}

async function explorerUpload(file){
 if(!file)return;
 if(file.size>explorerLimit)return alert('Максимальный размер файла — 3 МБ');
 const id=project,path=explorer.path;
 const button=root.querySelector('[data-act="filesUpload"]');if(button)button.disabled=true;
 try{
  const url='/.netlify/functions/files-explorer?'+new URLSearchParams({action:'upload',project:id,path,name:file.name});
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file,credentials:'same-origin',cache:'no-store'});
  let data={};try{data=await r.json()}catch{}
  if(!r.ok)throw Error(data.error||'Не удалось загрузить файл');
  if(id===project&&view==='files')explorerLoad(path);
 }catch(e){alert(e.message||'Не удалось загрузить файл')}
 finally{if(button?.isConnected)button.disabled=false}
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

root.addEventListener('change',e=>{
 if(e.target.id==='explorerUpload'){const file=e.target.files?.[0];e.target.value='';explorerUpload(file)}
});

function filesView(){
 if(explorer.project!==project)return '<section class="pane"><p class="help">Загрузка…</p></section>';
 const back=explorer.path?'<button type="button" class="btn small" data-act="filesUp">↑ На уровень выше</button>':'';
 const breadcrumbs=explorer.path?explorer.path.split('/').map(s=>' / '+esc(s)).join(''):'';
 const list=explorer.items.map(item=>{
  const isFolder=item.type==='folder',size=isFolder?'Папка':item.size==null?'':item.size<1024?item.size+' Б':item.size<1048576?(item.size/1024).toFixed(1)+' КБ':(item.size/1048576).toFixed(1)+' МБ';

  if(isFolder)return '<button type="button" class="fileEntry" data-act="filesOpen" data-path="'+esc(item.path)+'"><span class="fileGlyph" aria-hidden="true">📁</span><span class="fileEntryName">'+esc(item.name)+'</span><span class="fileEntryMeta">'+esc(size)+'</span><span aria-hidden="true">›</span></button>';
  return '<div class="fileEntry"><span class="fileActionButtons"><button type="button" class="fileActionBtn" data-act="filesPreview" data-path="'+esc(item.path)+'" data-name="'+esc(item.name)+'" data-mime="'+esc(item.mimeType||'')+'" title="Посмотреть" aria-label="Посмотреть '+esc(item.name)+'">🔍</button><button type="button" class="fileActionBtn" data-act="filesDownload" data-path="'+esc(item.path)+'" data-name="'+esc(item.name)+'" title="Скачать" aria-label="Скачать '+esc(item.name)+'">↓</button></span><button type="button" class="fileEntryNameAction" data-act="filesPreview" data-path="'+esc(item.path)+'" data-name="'+esc(item.name)+'" data-mime="'+esc(item.mimeType||'')+'">'+esc(item.name)+'</button><span class="fileEntryMeta">'+esc(size)+'</span><button type="button" class="fileActionBtn" data-act="pinFile" data-path="'+esc(item.path)+'" title="Закрепить в проекте" aria-label="Закрепить '+esc(item.name)+'">📌</button></div>';

 }).join('');
 const body=explorer.loading?'<div class="empty">Загрузка…</div>':explorer.error?'<div class="empty"><p>'+esc(explorer.error)+'</p><button class="btn" data-act="filesReload">Повторить</button></div>':list||'<div class="empty"><h3>Папка пуста</h3><p>Загрузите файл или создайте папку.</p></div>';
 return '<section class="pane explorerPane"><div class="explorerToolbar"><div><h2>Файлы проекта</h2><p class="help explorerPath">'+esc(cp()?.name||'Проект')+breadcrumbs+'</p></div><div class="explorerActions"><input id="explorerUpload" type="file" hidden><button type="button" class="btn small" data-act="filesUpload"'+(explorer.loading?' disabled':'')+'>↑ Загрузить</button><button type="button" class="btn small primary" data-act="filesMkdir"'+(explorer.loading?' disabled':'')+'>＋ Папка</button></div></div>'+back+'<div class="explorerList">'+body+'</div>'+(explorer.hasMore?'<p class="help">Показана часть элементов папки.</p>':'')+'</section>';
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
