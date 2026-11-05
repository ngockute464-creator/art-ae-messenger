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
 if(view==='files')render();
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
async function explorerDownload(path,name){
 try{
  const url='/.netlify/functions/files-explorer?'+new URLSearchParams({action:'download',project,path});
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});
  if(!r.ok){let data={};try{data=await r.json()}catch{};throw Error(data.error||'Не удалось скачать файл')}
  const blob=await r.blob();if(blob.size>explorerLimit)throw Error('Файл превышает лимит 3 МБ');
  const href=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=href;link.download=name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(href),30000);
 }catch(e){alert(e.message||'Не удалось скачать файл')}
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
  const tag='button';
  const attrs=' type="button" data-act="'+(isFolder?'filesOpen':'filesDownload')+'" data-path="'+esc(item.path)+'" data-name="'+esc(item.name)+'"';
  return '<'+tag+' class="fileEntry"'+attrs+'><span class="fileGlyph" aria-hidden="true">'+(isFolder?'📁':'📄')+'</span><span class="fileEntryName">'+esc(item.name)+'</span><span class="fileEntryMeta">'+esc(size)+'</span>'+(isFolder?'<span aria-hidden="true">›</span>':'<span aria-hidden="true">↓</span>')+'</'+tag+'>';
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
