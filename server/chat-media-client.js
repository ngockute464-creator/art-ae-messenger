// Lazy inline image/video previews for files stored in the private chat area.
// Signed download links are kept only in memory and refreshed when needed.
// No image scaling, video conversion or browser-sized re-upload of originals.
// Same-origin stream: the HttpOnly session cookie authorizes each media GET.
function chatMediaStreamUrl(source){
 return '/.netlify/functions/files-explorer?'+new URLSearchParams({
  action:'chatMedia',project:source.project,convo:source.convo,
  fileId:source.fileId,name:source.name,messageId:source.messageId
 });
}
function chatMediaKind(name){
 const kind=explorerKind(name,'');
 return kind==='image'||kind==='video'?kind:null;
}
function chatMediaHtml(file,message){
 const kind=chatMediaKind(file.name);
 if(!kind)return '';
 const attrs=' data-chat-kind="'+kind+'" data-chat-id="'+esc(file.id)+
  '" data-chat-name="'+esc(file.name)+'" data-chat-convo="'+esc(message.convo)+
  '" data-chat-message="'+esc(message.id)+'"';
 const element=kind==='image'?'<img alt="" loading="lazy">':
  '<video muted playsinline preload="metadata" aria-hidden="true"></video>';
 return '<button type="button" class="chatMediaThumb" data-chat-media="1"'+attrs+
  ' aria-label="Открыть '+(kind==='image'?'изображение ':'видео ')+esc(file.name)+'">'+
  '<span class="chatMediaVisual">'+element+
  '<span class="chatMediaLoading" aria-hidden="true">Загрузка…</span>'+
  (kind==='video'?'<span class="chatMediaPlay" aria-hidden="true">▶</span>':'')+'</span>'+
  '</button>';
}
function chatMediaValidatedUrl(href){
 let url;try{url=new URL(href)}catch{}
 if(!url||url.protocol!=='https:'||
    !/(^|\.)(yandex\.(ru|net)|yandexcloud\.net)$/.test(url.hostname)||
    url.username||url.password||(url.port&&url.port!=='443'))
  throw Error('Недопустимая ссылка Яндекс Диска');
 return url.href;
}
function chatMediaSource(el){
 return {kind:'chat',project,convo:el.dataset.chatConvo,
  fileId:el.dataset.chatId,name:el.dataset.chatName,
  messageId:el.dataset.chatMessage};
}
async function chatMediaLoadThumb(button){
 if(!button.isConnected||button.dataset.chatLoading==='1')return;
 button.dataset.chatLoading='1';
 const source=chatMediaSource(button),media=button.querySelector('img,video');
 if(!media)return;
 const state=button.querySelector('.chatMediaLoading');
 try{
  const href=chatMediaStreamUrl(source);
  if(!button.isConnected)return;
  const ready=()=>{if(!button.isConnected)return;
   button.classList.add('chatMediaReady');button.classList.remove('chatMediaError')};
  const fail=()=>{
   if(!button.isConnected)return;
   button.classList.add('chatMediaError');
   if(state)state.textContent='Не удалось загрузить. Нажмите для просмотра.'};
  media.addEventListener('load',ready,{once:true});
  media.addEventListener('loadedmetadata',ready,{once:true});
  media.addEventListener('error',fail,{once:true});
  media.referrerPolicy='no-referrer';
  media.src=button.dataset.chatKind==='video'?href+'#t=0.1':href;
  if(button.dataset.chatKind==='video'){
   // On mobile browsers first-frame decoding may wait for a tap. The video
   // still opens in the full player; do not claim that it loaded when it has not.
   setTimeout(()=>{if(!button.isConnected||button.classList.contains('chatMediaReady')||
       button.classList.contains('chatMediaError'))return;
    if(state)state.textContent='Нажмите, чтобы посмотреть видео';
   },2500);
  }
 }catch(error){
  if(!button.isConnected)return;
  button.classList.add('chatMediaError');
  if(state)state.textContent='Не удалось загрузить. Нажмите для просмотра.';
 }
}
let chatMediaScanPending=false;
const chatMediaIntersection=typeof IntersectionObserver!=='undefined'?
 new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){
   chatMediaIntersection.unobserve(entry.target);
   void chatMediaLoadThumb(entry.target);
  }
 },{rootMargin:'260px'}):null;
function chatMediaScan(){
 chatMediaScanPending=false;
 for(const node of root.querySelectorAll('.chatMediaThumb[data-chat-media]:not([data-chat-observed])')){
  node.dataset.chatObserved='1';
  if(chatMediaIntersection)chatMediaIntersection.observe(node);
  else void chatMediaLoadThumb(node);
 }
}
if(typeof MutationObserver!=='undefined'){
 new MutationObserver(()=>{
  if(chatMediaScanPending)return;
  chatMediaScanPending=true;queueMicrotask(chatMediaScan);
 }).observe(root,{childList:true,subtree:true});
}
queueMicrotask(chatMediaScan);
root.addEventListener('click',event=>{
 const button=event.target.closest?.('.chatMediaThumb[data-chat-media]');
 if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();
 const source=chatMediaSource(button),kind=button.dataset.chatKind;
 if(!['image','video'].includes(kind))return;
 void explorerPreview('',source.name,kind==='image'?'image/*':'video/*',source,button);
},true);

// Copy a private chat attachment, with its exact bytes, to a project folder.
// The server authorizes the message marker and does a Yandex Disk resource copy.
function chatMediaCopyPicker(source){
 const dialog=document.createElement('dialog');
 dialog.className='chatMediaPicker';dialog.setAttribute('aria-label','Сохранить файл в проект');
 dialog.innerHTML='<div class="chatMediaPickerHeader"><strong>Сохранить в файлы проекта</strong>'+
  '<button class="btn small" type="button" aria-label="Закрыть">✕</button></div>'+
  '<div class="chatMediaPickerBody"><div class="chatMediaPickerStatus" data-copy-location>Корень проекта</div>'+
  '<div class="chatMediaPickerFolder" data-copy-folders>Загрузка папок…</div>'+
  '<label for="chatMediaCopyName">Имя файла</label>'+
  '<input id="chatMediaCopyName" class="chatMediaPickerName" type="text" maxlength="120">'+
  '<div class="chatMediaPickerStatus" data-copy-status role="status"></div></div>'+
  '<div class="chatMediaPickerFooter"><button type="button" class="btn" data-copy-cancel>Отмена</button>'+
  '<button type="button" class="btn primary" data-copy-save>Сохранить</button></div>';
 const close=dialog.querySelector('.chatMediaPickerHeader button');
 const cancel=dialog.querySelector('[data-copy-cancel]');
 const save=dialog.querySelector('[data-copy-save]');
 const nameInput=dialog.querySelector('#chatMediaCopyName');
 const status=dialog.querySelector('[data-copy-status]');
 const location=dialog.querySelector('[data-copy-location]');
 const folderList=dialog.querySelector('[data-copy-folders]');
 nameInput.value=source.name;
 let folder='',browseId=0,busy=false,completed=false;
 const dismiss=()=>{if(!busy&&dialog.open)dialog.close()};
 close.addEventListener('click',dismiss);cancel.addEventListener('click',dismiss);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 document.body.append(dialog);dialog.showModal();
 async function browse(path){
  if(busy||!dialog.open)return;
  const id=++browseId;folder=path;
  location.textContent='Файлы проекта'+(path?' / '+path:' /');
  folderList.textContent='Загрузка папок…';
  try{
   const result=await explorerApi('list',{project:source.project,path});
   if(id!==browseId||!dialog.open)return;
   folderList.replaceChildren();
   const folderButton=(title,next)=>{
    const button=document.createElement('button');button.type='button';
    button.textContent=title;button.addEventListener('click',()=>{void browse(next)});
    folderList.append(button);
   };
   if(path)folderButton('← На уровень выше',path.split('/').slice(0,-1).join('/'));
   const dirs=(result.items||[]).filter(item=>item.type==='folder');
   for(const item of dirs)folderButton('📁 '+item.name,item.path);
   if(!dirs.length&&!path)folderList.textContent='В корне проекта пока нет папок';
   else if(!dirs.length&&path) {
    const text=document.createElement('p');text.className='chatMediaPickerStatus';
    text.textContent='Вложенных папок нет';folderList.append(text);
   }
   if(result.hasMore){
    const notice=document.createElement('p');notice.className='chatMediaPickerStatus';
    notice.textContent='Показаны не все папки: список слишком большой.';
    folderList.append(notice);
   }
  }catch(error){
   if(id===browseId&&dialog.open)folderList.textContent=String(error?.message||error);
  }
 }
 save.addEventListener('click',()=>{
  if(busy)return;
  if(completed){dismiss();return}
  const destName=nameInput.value.trim();
  if(!destName||destName.length>120||/[\\/:*?"<>|\x00-\x1f]/.test(destName)||
     destName==='.'||destName==='..'||destName.endsWith('.')){
   status.textContent='Укажите допустимое имя файла';nameInput.focus();return;
  }
  busy=true;save.disabled=true;nameInput.disabled=true;
  status.textContent='Сохраняем оригинал без изменения качества…';
  void (async()=>{
   try{
    const result=await chatApi('chatCopyToProject',{
     project:source.project,convo:source.convo,messageId:source.messageId,
     fileId:source.fileId,name:source.name,path:folder,targetName:destName
    });
    if(result.operationId){
     for(let i=0;i<25;i++){
      if(!dialog.open)return;
      await new Promise(done=>setTimeout(done,600));
      const op=await chatApi('chatCopyStatus',{project:source.project,operationId:result.operationId});
      if(op.done){result.done=true;break}
     }
    }
    if(!dialog.open)return;
    if(result.done){
     completed=true;
     status.textContent='Сохранено: '+result.path;
     save.textContent='Готово';save.disabled=false;
     cancel.hidden=true;
     if(explorer.project===source.project&&explorer.path===folder&&
        (view==='files'||railFileVisible()))void explorerLoad(folder);
    }else{
     status.textContent='Копирование продолжается на Яндекс Диске. Файл появится в выбранной папке.';
     // The remote asynchronous copy has been accepted. Closing the
     // dialog must not submit the operation again.
     completed=true;save.textContent='Готово';save.disabled=false;
     cancel.hidden=true;
    }
   }catch(error){
    if(dialog.open){
     status.textContent=String(error?.message||error);
     save.disabled=false;nameInput.disabled=false;
    }
   }finally{busy=false}
  })();
 });
 void browse('');
 return dialog;
}
