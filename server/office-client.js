// Open authenticated ART-AE project documents inside our self-hosted VibeOffice.
// Downloading a changed copy is handled by VibeOffice's built-in File > Save.
(() => {
'use strict';
// Keep the copy-only editor handler unique even if a cached HTML shell loads
// the legacy standalone script alongside the versioned app.js.
if(window.__ARTAE_OFFICE_READY__)return;
window.__ARTAE_OFFICE_READY__=true;
let active=null;
let warmDocx=null;
function makeOfficeFrame(kind,name){
 const frame=document.createElement('iframe');
 frame.className='artaeOfficeFrame';
 frame.title='VibeOffice — '+name;
 frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-modals');
 frame.src='/office/'+kind+'/';
 return frame;
}
// Starts the DOCX engine after the user has opened an authenticated project's files.
// The iframe is kept mounted until the document opens; no file data is preloaded.
function prewarmOfficeDocx(){
 if(warmDocx||active)return;
 const frame=makeOfficeFrame('quire','предварительная загрузка DOCX');
 const host=document.createElement('div');
 host.className='artaeOfficeWarmHost';
 host.append(frame);
 const ctx={host,frame,ready:false,started:performance.now()};
 warmDocx=ctx;
 ctx.listener=event=>{
  if(warmDocx!==ctx||event.origin!==location.origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='artae-office-ready'){
   ctx.ready=true;
   console.info('[ART-AE Office] DOCX prewarmed in '+Math.round(performance.now()-ctx.started)+' ms');
  }
 };
 window.addEventListener('message',ctx.listener);
 document.body.append(host);
}

function close(){
 const a=active;if(!a)return;active=null;
 window.removeEventListener('message',a.message);
 a.overlay.remove();
 // Do not retain a previous document or its unsaved state in the warm editor.
 // Prepare a fresh DOCX instance only after the previous one is fully closed.
 if(a.kind==='quire')setTimeout(prewarmOfficeDocx,250);
}
async function openProjectDocument(path,name,projectId,localFile=null){
 if(active)return;
 if(!/\.(docx|xlsx)$/i.test(name))return;
 if(!localFile&&!projectId){alert('Не удалось определить проект файла. Обновите список файлов.');return;}
 const overlay=document.createElement('div');overlay.className='artaeOfficeOverlay';
 const box=document.createElement('section');box.className='artaeOfficePanel';
 box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','Редактирование '+name);
 const top=document.createElement('header');top.className='artaeOfficeTop';
 const title=document.createElement('strong');title.textContent=name;
 const state=document.createElement('span');state.className='artaeOfficeState';state.textContent=localFile?'Читаем локальный файл…':'Загрузка файла…';
 const hint=document.createElement('span');hint.className='artaeOfficeHint';hint.textContent='Сохранение → скачивание копии';
 const closeButton=document.createElement('button');closeButton.type='button';closeButton.textContent='Закрыть';closeButton.className='artaeOfficeClose';
 closeButton.addEventListener('click',()=>{if(confirm('Закрыть редактор? Несохранённые изменения могут быть потеряны.'))close()});
 top.append(title,state,hint,closeButton);
 const kind=/\.docx$/i.test(name)?'quire':'ledger';
 const warm=kind==='quire'?warmDocx:null;
 if(warm){
  window.removeEventListener('message',warm.listener);
  warmDocx=null;
  warm.host.remove();
 }
 const frame=warm?.frame||makeOfficeFrame(kind,name);
 frame.title='VibeOffice — '+name;
 box.append(top,frame);overlay.append(box);
 const started=performance.now();
 const ctx={overlay,frame,kind,message:null,buffer:null,name,projectId,ready:!!warm?.ready,sent:false,started,sentAt:0,readyAt:warm?.ready?started:0,fileAt:0,prewarmed:!!warm?.ready};active=ctx;
 const send=()=>{if(!ctx.ready||!ctx.buffer||ctx.sent)return;ctx.sent=true;ctx.sentAt=performance.now();frame.contentWindow.postMessage({type:'artae-office-open',name,buffer:ctx.buffer},location.origin,[ctx.buffer]);ctx.buffer=null;state.textContent='Открываем документ… (подготовка '+Math.round(ctx.sentAt-ctx.started)+' мс)'};
 ctx.message=event=>{
  if(active!==ctx||event.origin!==location.origin||event.source!==frame.contentWindow)return;
  const msg=event.data;if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='artae-office-ready'){
   ctx.ready=true;ctx.readyAt=performance.now();
   send();
  }else if(msg.type==='artae-office-opened'){const now=performance.now(),editorStart=Math.round(ctx.readyAt-ctx.started),fileReady=Math.round(ctx.fileAt-ctx.started),processing=Math.round(now-ctx.sentAt),total=Math.round(now-ctx.started),waiting=Math.round(ctx.sentAt-Math.max(ctx.readyAt,ctx.fileAt));state.textContent='Готово · всего '+(total/1000).toFixed(1)+' с · запуск '+(editorStart/1000).toFixed(1)+' с · обработка '+(processing/1000).toFixed(1)+' с';console.info('[ART-AE Office] '+name,{source:localFile?'local':'project',prewarmed:ctx.prewarmed,editorStartMs:editorStart,fileReadyMs:fileReady,waitingMs:waiting,processingMs:processing,totalMs:total});}
  else if(msg.type==='artae-office-error')state.textContent='Ошибка: '+String(msg.message||'Не удалось открыть').slice(0,200);
 };
 window.addEventListener('message',ctx.message);
 document.body.append(overlay);
 if(ctx.prewarmed)console.info('[ART-AE Office] Reusing ready DOCX editor');
 try{
  // Existing session-protected files API; no credentials given to the editor.
  let blob=localFile;
  if(!blob){
   const url='/.netlify/functions/files-explorer?'+new URLSearchParams({action:'download',project:projectId,path});
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok){let details={};try{details=await response.json()}catch{}
    throw Error(details.error||'Не удалось получить документ: HTTP '+response.status)}
   blob=await response.blob();
  }
  if(blob.size>3*1024*1024)throw Error('Файл превышает лимит теста 3 МБ');
  if(active!==ctx)return;
  ctx.buffer=await blob.arrayBuffer();
  ctx.fileAt=performance.now();
  send();
 }catch(error){if(active===ctx)state.textContent='Ошибка загрузки: '+String(error?.message||error)}
}
document.addEventListener('click',event=>{
 const local=event.target.closest('[data-act="officeLocalFile"]');
 if(local){
  event.preventDefault();event.stopImmediatePropagation();
  const input=document.createElement('input');
  input.type='file';input.accept='.docx,.xlsx';input.hidden=true;
  document.body.append(input);
  input.addEventListener('change',()=>{
   const file=input.files?.[0];input.remove();
   if(!file)return;
   if(!/\.(docx|xlsx)$/i.test(file.name))return alert('Выберите DOCX или XLSX');
   if(file.size>3*1024*1024)return alert('Для теста поддерживаются файлы до 3 МБ');
   openProjectDocument('',file.name,'',file).catch(e=>alert('Ошибка редактора: '+String(e?.message||e)));
  },{once:true});
  input.click();
  return;
 }
 const button=event.target.closest('[data-act="officeEdit"]');if(!button)return;
 event.preventDefault();event.stopImmediatePropagation();
 openProjectDocument(button.dataset.path||'',button.dataset.name||'',button.dataset.project||'')
  .catch(error=>alert('Не удалось открыть редактор: '+String(error?.message||error)));
},true);
const css=document.createElement('style');css.textContent=`
.artaeOfficeWarmHost{position:fixed;left:0;top:0;width:min(1100px,100vw);height:80vh;opacity:0;pointer-events:none;z-index:-1;overflow:hidden}
.artaeOfficeWarmHost iframe{width:100%;height:100%;border:0}
.artaeOfficeOverlay{position:fixed;inset:0;z-index:100001;background:var(--surface,#fff);display:flex}
.artaeOfficePanel{display:flex;flex-direction:column;min-width:0;width:100%;height:100dvh}
.artaeOfficeTop{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #dde3eb;min-height:52px;font:13px system-ui}
.artaeOfficeTop strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.artaeOfficeState{color:#52718b;font-size:12px;flex:1}
.artaeOfficeHint{font-size:12px;color:#66778a}
.artaeOfficeClose{border:1px solid #d5dce8;border-radius:8px;background:transparent;padding:9px 12px;color:inherit;cursor:pointer}
.artaeOfficeFrame{flex:1;min-height:0;width:100%;border:0;background:#fff}
@media(max-width:650px){.artaeOfficeTop{gap:7px;flex-wrap:wrap;padding:6px 9px}.artaeOfficeTop strong{flex-basis:40%}.artaeOfficeHint{display:none}}
`;
document.head.append(css);
})();
