// Open authenticated ART-AE project documents inside our self-hosted VibeOffice.
// Downloading a changed copy is handled by VibeOffice's built-in File > Save.
(() => {
'use strict';
// Keep the copy-only editor handler unique even if a cached HTML shell loads
// the legacy standalone script alongside the versioned app.js.
if(window.__ARTAE_OFFICE_READY__)return;
window.__ARTAE_OFFICE_READY__=true;
let active=null;
async function officeLeaseRequest(action,ctx){
 const response=await fetch('/.netlify/functions/files-explorer',{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({action,project:ctx.projectId,path:ctx.path,editToken:ctx.editToken}),
  keepalive:action==='officeEditRelease'});
 let result={};try{result=await response.json()}catch{}
 if(!response.ok||!result.ok)throw Error(result.error||(result.holder?'Редактирует '+result.holder:'Не удалось получить блокировку документа'));
 return result;
}
function releaseOfficeLease(ctx){
 if(!ctx?.editToken||ctx.released)return;
 ctx.released=true;
 if(ctx.leaseTimer){clearInterval(ctx.leaseTimer);ctx.leaseTimer=null}
 officeLeaseRequest('officeEditRelease',ctx).catch(e=>console.warn('Office unlock failed, lease will expire',e));
}
function startOfficeLeaseHeartbeat(ctx,state,saveButton){
 if(!ctx.editToken)return;
 ctx.leaseTimer=setInterval(async()=>{
  if(ctx.renewing||ctx.released||active!==ctx)return;
  ctx.renewing=true;
  try{await officeLeaseRequest('officeEditRenew',ctx);ctx.leaseFailed=false}
  catch(error){ctx.leaseFailed=true;state.textContent='Блокировка утрачена. Сохранение недоступно: '+String(error.message||error);saveButton.disabled=true}
  finally{ctx.renewing=false}
 },30000);
}

let warmDocx=null;
let warmXlsx=null;
const officeOrigin=window.ARTAE_OFFICE_ORIGIN||null;
function requireOfficeOrigin(){
 if(!officeOrigin)throw Error('Отдельный Office-сайт не настроен');
 const u=new URL(officeOrigin);
 if(u.protocol!=='https:'||u.origin!==officeOrigin||u.origin===location.origin)
  throw Error('Небезопасный адрес Office');
 return u.origin;
}
function makeOfficeFrame(kind,name){
 const frame=document.createElement('iframe');
 frame.className='artaeOfficeFrame';
 frame.title='VibeOffice — '+name;
 frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-modals');
 frame.src=requireOfficeOrigin()+'/'+kind+'/';
 return frame;
}
// Starts the DOCX engine after the user has opened an authenticated project's files.
// The iframe is kept mounted until the document opens; no file data is preloaded.
function prewarmOfficeDocx(){
 if(warmDocx||active||!officeOrigin)return;
 const frame=makeOfficeFrame('quire','предварительная загрузка DOCX');
 const host=document.createElement('div');
 host.className='artaeOfficeWarmHost';
 host.append(frame);
 const ctx={host,frame,ready:false,started:performance.now()};
 warmDocx=ctx;
 ctx.listener=event=>{
  if(warmDocx!==ctx||event.origin!==officeOrigin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='artae-office-ready'){
   ctx.ready=true;
   console.info('[ART-AE Office] DOCX prewarmed in '+Math.round(performance.now()-ctx.started)+' ms');
  }
 };
 window.addEventListener('message',ctx.listener);
 document.body.append(host);
}
// Ledger is prepared after file-list rendering. Keep it mounted so opening it
// does not reset the iframe. Never prefetch project files or credentials.
function prewarmOfficeXlsx(){
 if(warmXlsx||active||!officeOrigin)return;
 const frame=makeOfficeFrame('ledger','предварительная загрузка XLSX');
 const host=document.createElement('div');host.className='artaeOfficeWarmHost';host.append(frame);
 const ctx={host,frame,ready:false,started:performance.now()};warmXlsx=ctx;
 ctx.listener=event=>{
  if(warmXlsx!==ctx||event.origin!==officeOrigin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='artae-office-ready'){
   ctx.ready=true;
   console.info('[ART-AE Office] XLSX prewarmed in '+Math.round(performance.now()-ctx.started)+' ms');
  }
 };
 window.addEventListener('message',ctx.listener);document.body.append(host);
}
window.ARTAE_OFFICE_PREWARM_XLSX=prewarmOfficeXlsx;
// Expose only the optional warm-up function to the file browser.
window.ARTAE_OFFICE_PREWARM=prewarmOfficeDocx;

function close(){
 const a=active;if(!a)return;active=null;releaseOfficeLease(a);
 window.removeEventListener('message',a.message);
 if(a.pdfUrl){URL.revokeObjectURL(a.pdfUrl);a.pdfUrl=null}
 a.overlay.remove();
 if(a.kind==='ledger')setTimeout(()=>{try{prewarmOfficeXlsx()}catch(error){console.warn('XLSX warm-up:',error)}},800);
}
function finishDocxClose(ctx){
 if(active!==ctx)return;
 active=null;releaseOfficeLease(ctx);
 window.removeEventListener('message',ctx.message);
 if(ctx.pdfUrl){URL.revokeObjectURL(ctx.pdfUrl);ctx.pdfUrl=null}
 const host=ctx.overlay;
 host.querySelectorAll('.artaePdfViewer,.artaePdfFallback,.artaePdfActions').forEach(el=>el.remove());
 ctx.frame.style.display='';
 // The iframe never leaves its DOM parent; closing Quire resets to a fresh
 // blank document before we hide it. Keep the ready engine for the next DOCX.
 const header=host.querySelector('.artaeOfficeTop');
 if(header)header.remove();
 host.classList.remove('artaeOfficeWarmActive');
 host.classList.add('artaeOfficeWarmHost');
 const warm={host,frame:ctx.frame,ready:true,started:performance.now()};
 warm.listener=event=>{
  if(warmDocx!==warm||event.origin!==officeOrigin||event.source!==warm.frame.contentWindow)return;
  if(event.data?.type==='artae-office-ready')warm.ready=true;
 };
 warmDocx=warm;
 window.addEventListener('message',warm.listener);
 console.info('[ART-AE Office] DOCX reset completed; ready instance retained');
 if(!warmXlsx)setTimeout(()=>{try{prewarmOfficeXlsx()}catch(error){console.warn('XLSX warm-up:',error)}},1000);
}
async function openProjectDocument(path,name,projectId,localFile=null,mode='edit'){
 if(active){
  alert('Сначала закройте открытый документ, затем повторите просмотр.');
  return;
 }
 try{requireOfficeOrigin()}catch(error){alert(error.message);return}
 if(!/\.(docx|xlsx)$/i.test(name))return;
 if(!localFile&&!projectId){alert('Не удалось определить проект файла. Обновите список файлов.');return;}
 // Atomically lock before initializing the editor, including Office prewarm reuse.
 let acquired=null;
 if(mode==='edit'&&!localFile){
  try{acquired=await officeLeaseRequest('officeEditAcquire',{projectId,path,editToken:null})}
  catch(e){alert('Документ уже редактируется или блокировка недоступна. '+String(e.message||e));return}
 }
 let overlay=document.createElement('div');overlay.className='artaeOfficeOverlay';
 const box=document.createElement('section');box.className='artaeOfficePanel';
 box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',(mode==='preview'?'Просмотр ':'Редактирование ')+name);
 const top=document.createElement('header');top.className='artaeOfficeTop';
 const title=document.createElement('strong');title.textContent=name;
 const state=document.createElement('span');state.className='artaeOfficeState';state.textContent=localFile?'Читаем локальный файл…':'Загрузка файла…';
 const hint=document.createElement('span');hint.className='artaeOfficeHint';hint.textContent=mode==='preview'?'PDF-просмотр':localFile?'Локальная копия':'Сохранение → Яндекс Диск';
 const saveButton=document.createElement('button');saveButton.type='button';saveButton.textContent='Сохранить';saveButton.className='artaeOfficeSave';saveButton.hidden=mode!=='edit'||!!localFile;
 saveButton.addEventListener('click',()=>{
  if(!active||active.saving||active.savePreparing)return;
  active.savePreparing=true;
  active.frame.contentWindow.postMessage({type:'artae-office-save-command'},officeOrigin);
 });
 const closeButton=document.createElement('button');closeButton.type='button';closeButton.textContent='Закрыть';closeButton.className='artaeOfficeClose';
 closeButton.addEventListener('click',()=>{
  if(active?.saving||active?.savePreparing){state.textContent='Сохранение выполняется. Закройте после завершения.';return;}
  if(kind==='quire'){
   if(!active||active.closing)return;
   active.closing=true;
   closeButton.disabled=true;
   state.textContent='Проверка несохранённых изменений…';
   active.frame.contentWindow.postMessage({type:'artae-office-close'},officeOrigin);
   active.closeTimer=setTimeout(()=>{
    if(active&&active.closing){active.closing=false;closeButton.disabled=false;state.textContent='Не удалось закрыть документ. Повторите попытку.'}
   },30000);
  }else if(confirm('Закрыть редактор? Несохранённые изменения могут быть потеряны.'))close();
 });
 top.append(title,state,hint,saveButton,closeButton);
 const kind=/\.docx$/i.test(name)?'quire':'ledger';
 if(kind==='quire'&&!warmDocx)prewarmOfficeDocx();
 if(kind==='ledger'&&!warmXlsx)prewarmOfficeXlsx();
 const warm=kind==='quire'?warmDocx:warmXlsx;
 const warmInfo=warm?(warm.ready?'готов до клика':'запущен, но не готов'):'не запускался';
 const warmAge=warm?Math.round(performance.now()-warm.started):0;
 console.info('[ART-AE Office] warmup at click:',{kind,warmInfo,warmAgeMs:warmAge});
 if(warm){
  window.removeEventListener('message',warm.listener);
  if(kind==='quire')warmDocx=null;else warmXlsx=null;
 }
 const frame=warm?.frame||makeOfficeFrame(kind,name);
 frame.title='VibeOffice — '+name;
 if(warm){
  // Reparenting an iframe can destroy its browsing context and start it again.
  // Keep the already-running frame in its original container.
  overlay=warm.host;
  overlay.classList.add('artaeOfficeWarmActive');
  overlay.insertBefore(top,frame);
 }else{
  box.append(top,frame);
  overlay.append(box);
 }
 const started=performance.now();
 const ctx={overlay,frame,kind,mode,pdfUrl:null,message:null,buffer:null,name,projectId,ready:!!warm?.ready,sent:false,started,sentAt:0,readyAt:warm?.ready?started:0,fileAt:0,prewarmed:!!warm?.ready,warmInfo,warmAge,closing:false,closeTimer:null,version:null,saving:false,savePreparing:false,editToken:acquired?.editToken||null,path,leaseTimer:null,renewing:false,leaseFailed:false,released:false};active=ctx;
 startOfficeLeaseHeartbeat(ctx,state,saveButton);
 const send=()=>{if(!ctx.ready||!ctx.buffer||ctx.sent)return;ctx.sent=true;ctx.sentAt=performance.now();frame.contentWindow.postMessage({type:'artae-office-open',name,buffer:ctx.buffer,remoteSave:mode==='edit'&&!localFile},officeOrigin,[ctx.buffer]);ctx.buffer=null;state.textContent='Открываем документ… (подготовка '+Math.round(ctx.sentAt-ctx.started)+' мс)'};
 ctx.message=event=>{
  if(active!==ctx||event.origin!==officeOrigin||event.source!==frame.contentWindow)return;
  const msg=event.data;if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='artae-office-save-command-done'){ctx.savePreparing=false;return;}
  if(msg.type==='artae-office-save'){
   if(ctx.mode!=='edit'||localFile||ctx.saving||ctx.leaseFailed||!ctx.editToken||!ctx.version||!(msg.blob instanceof Blob)||msg.blob.size===0){
    frame.contentWindow.postMessage({type:'artae-office-save-result',requestId:msg.requestId,ok:false,error:'Сохранение недоступно'},officeOrigin);
    return;
   }
   ctx.savePreparing=false;ctx.saving=true;state.textContent='Сохраняем на Яндекс Диск…';
   void (async()=>{
    let ok=false,error='';
    try{
     const query=new URLSearchParams({action:'officeSave',project:projectId,path,expectedModified:ctx.version,editToken:ctx.editToken});
     let result={};
     if(msg.blob.size<=3*1024*1024){
      const response=await fetch('/.netlify/functions/files-explorer?'+query,{
       method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:msg.blob
      });
      try{result=await response.json()}catch{}
      if(!response.ok)throw Error(result.error||'Ошибка сохранения (HTTP '+response.status+')');
     }else{
      // Keep large binary bytes out of Netlify's body-size-limited Functions.
      const auth=await fetch('/.netlify/functions/files-explorer',{
       method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({action:'officeSaveLink',project:projectId,path,expectedModified:ctx.version,editToken:ctx.editToken})
      });
      let signed={};try{signed=await auth.json()}catch{}
      if(!auth.ok)throw Error(signed.error||'Не удалось подтвердить версию документа');
      let uploaded;
      try{uploaded=await fetch(signed.href,{method:signed.method||'PUT',body:msg.blob,credentials:'omit'})}
      catch{throw Error('Браузер заблокировал запись большого документа в Яндекс Диск (CORS). Изменения остались в редакторе. Скачайте копию через меню «Файл».')}
      if(!uploaded.ok)throw Error('Яндекс Диск не принял документ (HTTP '+uploaded.status+')');
      const versionResponse=await fetch('/.netlify/functions/files-explorer?'+new URLSearchParams({action:'officeVersion',project:projectId,path}),{credentials:'same-origin',cache:'no-store'});
      try{result=await versionResponse.json()}catch{}
      if(!versionResponse.ok)throw Error(result.error||'Не удалось подтвердить новую версию');
     }
     if(typeof result.modified!=='string'||!result.modified)throw Error('Сервер не подтвердил новую версию документа');
     ctx.version=result.modified;ok=true;state.textContent='Сохранено на Яндекс Диске';
     if(typeof explorerLoad==='function'&&projectId===project&&explorer?.path===path.split('/').slice(0,-1).join('/'))void explorerLoad(explorer.path);
    }catch(e){error=String(e?.message||e);state.textContent='Ошибка сохранения: '+error.slice(0,140)}
    finally{ctx.saving=false;frame.contentWindow.postMessage({type:'artae-office-save-result',requestId:msg.requestId,ok,error},officeOrigin)}
   })();
   return;
  }
  if(msg.type==='artae-office-ready'){
   ctx.ready=true;ctx.readyAt=performance.now();
   console.info('[ART-AE Office] iframe ready after click',Math.round(ctx.readyAt-ctx.started),'ms');
   send();
  }else if(msg.type==='artae-office-opened'){const now=performance.now(),editorStart=Math.round(ctx.readyAt-ctx.started),fileReady=Math.round(ctx.fileAt-ctx.started),processing=Math.round(now-ctx.sentAt),total=Math.round(now-ctx.started),waiting=Math.round(ctx.sentAt-Math.max(ctx.readyAt,ctx.fileAt));state.textContent='Готово · всего '+(total/1000).toFixed(1)+' с · запуск '+(editorStart/1000).toFixed(1)+' с · файл '+(fileReady/1000).toFixed(1)+' с · обработка '+(processing/1000).toFixed(1)+' с · прогрев: '+ctx.warmInfo+(ctx.warmAge?' ('+(ctx.warmAge/1000).toFixed(1)+' с)':'');if(ctx.mode==='preview'){state.textContent='Создаём PDF…';frame.contentWindow.postMessage({type:'artae-office-export-pdf'},officeOrigin)}console.info('[ART-AE Office] '+name,{source:localFile?'local':'project',prewarmed:ctx.prewarmed,editorStartMs:editorStart,fileReadyMs:fileReady,waitingMs:waiting,processingMs:processing,totalMs:total});}
  else if(msg.type==='artae-office-pdf'&&ctx.mode==='preview'){
   if(!(msg.blob instanceof Blob)||msg.blob.type!=='application/pdf'||msg.blob.size===0){state.textContent='Ошибка: редактор не вернул PDF';return;}
   ctx.pdfUrl=URL.createObjectURL(msg.blob);
   frame.style.display='none';
   // A browser PDF viewer is not an HTML editor. A sandboxed iframe can
   // prevent the browser's built-in PDF renderer from starting.
   const viewer=document.createElement('object');viewer.className='artaePdfViewer';
   viewer.type='application/pdf';viewer.data=ctx.pdfUrl;viewer.title='PDF — '+name;
   const fallback=document.createElement('div');fallback.className='artaePdfUnavailable';
   fallback.textContent='Встроенный просмотр PDF недоступен в этом браузере.';
   const fallbackOpen=document.createElement('a');fallbackOpen.href=ctx.pdfUrl;fallbackOpen.target='_blank';fallbackOpen.rel='noopener';fallbackOpen.textContent='Открыть PDF';
   fallback.append(' ',fallbackOpen);viewer.append(fallback);
   const links=document.createElement('div');links.className='artaePdfActions';
   const link=document.createElement('a');link.className='artaePdfFallback';link.href=ctx.pdfUrl;link.target='_blank';link.rel='noopener';link.textContent='Открыть PDF в новой вкладке';
   const download=document.createElement('a');download.className='artaePdfFallback';download.href=ctx.pdfUrl;download.download=name.replace(/\.(docx|xlsx)$/i,'.pdf');download.textContent='Скачать PDF';
   links.append(link,download);
   frame.parentElement.append(viewer,links);state.textContent='PDF готов · встроенный просмотр или открытие в новой вкладке';
  }
  else if(msg.type==='artae-office-close-result'){
   clearTimeout(ctx.closeTimer);ctx.closeTimer=null;ctx.closing=false;closeButton.disabled=false;
   if(msg.closed)finishDocxClose(ctx);
   else state.textContent=msg.error?'Ошибка закрытия: '+String(msg.error).slice(0,140):'Закрытие отменено';
  }
  else if(msg.type==='artae-office-error')state.textContent='Ошибка: '+String(msg.message||'Не удалось открыть').slice(0,200);
 };
 window.addEventListener('message',ctx.message);
 if(!warm)document.body.append(overlay);
 if(ctx.prewarmed)console.info('[ART-AE Office] Reusing ready '+kind+' editor');
 try{
  // Existing session-protected files API; no credentials given to the editor.
  let blob=localFile;
  if(!blob){
   const versionUrl='/.netlify/functions/files-explorer?'+new URLSearchParams({action:'officeVersion',project:projectId,path});
   const versionResponse=await fetch(versionUrl,{credentials:'same-origin',cache:'no-store'});
   let info={};try{info=await versionResponse.json()}catch{}
   if(!versionResponse.ok||typeof info.modified!=='string')throw Error(info.error||'Не удалось проверить версию документа');
   ctx.version=info.modified;
   const url='/.netlify/functions/files-explorer?'+new URLSearchParams({action:'download',project:projectId,path});
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
   if(response.status===413){
    const signedResponse=await fetch('/.netlify/functions/files-explorer?'+new URLSearchParams({action:'downloadLink',project:projectId,path}),{credentials:'same-origin',cache:'no-store'});
    let signed={};try{signed=await signedResponse.json()}catch{}
    if(!signedResponse.ok)throw Error(signed.error||'Не удалось получить ссылку на большой документ');
    let direct;
    try{direct=await fetch(signed.href,{credentials:'omit',cache:'no-store'})}
    catch{throw Error('Браузер не разрешил открыть большой документ с Яндекс Диска (CORS).')}
    if(!direct.ok)throw Error('Яндекс Диск не выдал документ');
    blob=await direct.blob();
   }else{
    if(!response.ok){let details={};try{details=await response.json()}catch{}
     throw Error(details.error||'Не удалось получить документ: HTTP '+response.status)}
    blob=await response.blob();
   }
  }
  if(active!==ctx)return;
  ctx.buffer=await blob.arrayBuffer();
  ctx.fileAt=performance.now();
  send();
 }catch(error){if(active===ctx){state.textContent='Ошибка загрузки: '+String(error?.message||error);releaseOfficeLease(ctx)}}
}
window.ARTAE_OFFICE_PREVIEW=(path,name,projectId)=>openProjectDocument(path,name,projectId,null,'preview');
// Central file explorer routes preview actions; only edit uses capture here.
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-act="officeEdit"]');if(!button)return;
 const preview=false;
 event.preventDefault();event.stopImmediatePropagation();
 openProjectDocument(button.dataset.path||'',button.dataset.name||'',button.dataset.project||project,null,preview?'preview':'edit')
  .catch(error=>alert('Не удалось открыть редактор: '+String(error?.message||error)));
},true);
const css=document.createElement('style');css.textContent=`
.artaePdfViewer{flex:1;width:100%;height:100%;border:0;min-height:0}
.artaePdfActions{display:flex;gap:12px;flex-wrap:wrap;padding:6px 12px}.artaePdfFallback{font:13px sans-serif}.artaePdfUnavailable{padding:20px;font:14px sans-serif}
.artaeOfficeWarmHost{position:fixed;left:0;top:0;width:min(1100px,100vw);height:80vh;opacity:0;pointer-events:none;z-index:-1;overflow:hidden}
.artaeOfficeWarmHost iframe{width:100%;height:100%;border:0}
.artaeOfficeWarmHost.artaeOfficeWarmActive{inset:0;width:100%;height:100dvh;opacity:1;pointer-events:auto;z-index:100001;display:flex;flex-direction:column;background:var(--surface,#fff)}
.artaeOfficeWarmActive iframe{flex:1;min-height:0;width:100%;height:auto}
.artaeOfficeOverlay{position:fixed;inset:0;z-index:100001;background:var(--surface,#fff);display:flex}
.artaeOfficePanel{display:flex;flex-direction:column;min-width:0;width:100%;height:100dvh}
.artaeOfficeTop{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #dde3eb;min-height:52px;font:13px system-ui}
.artaeOfficeTop strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.artaeOfficeState{color:#52718b;font-size:12px;flex:1}
.artaeOfficeHint{font-size:12px;color:#66778a}
.artaeOfficeSave{border:1px solid #2869dc;border-radius:8px;background:#2869dc;color:white;padding:9px 12px;cursor:pointer;font:inherit}.artaeOfficeSave[hidden]{display:none}
.artaeOfficeClose{border:1px solid #d5dce8;border-radius:8px;background:transparent;padding:9px 12px;color:inherit;cursor:pointer}
.artaeOfficeFrame{flex:1;min-height:0;width:100%;border:0;background:#fff}
@media(max-width:650px){.artaeOfficeTop{gap:7px;flex-wrap:wrap;padding:6px 9px}.artaeOfficeTop strong{flex-basis:40%}.artaeOfficeHint{display:none}}
`;
window.addEventListener('pagehide',()=>{if(active)releaseOfficeLease(active)});
document.head.append(css);
})();
