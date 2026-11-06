// ART-AE file handoff. No authentication tokens are sent to the office frame.
(() => {
'use strict';
const origin=__ARTAE_PARENT_ORIGIN__;
if(!origin||origin===location.origin)throw Error('ART-AE parent origin must differ from Office');
const ready=()=>window.L&&window.L.app&&typeof window.L.app.openFile==='function';
let started=false;
let saveBridge=null;
function installSaveBridge(name,enabled){
 if(saveBridge){window.L.saveFile=saveBridge.original;saveBridge=null}
 if(!enabled)return;
 const original=window.L.saveFile;
 if(typeof original!=='function')throw Error('Экспорт документа недоступен');
 const pending=new Map();
 saveBridge={name,original,pending};
 window.L.saveFile=async function(savedName,blob){
  // Save As to a different name stays a local download; the original is unchanged.
  if(savedName!==name)return original.call(this,savedName,blob);
  if(!(blob instanceof Blob)||!blob.size)throw Error('Редактор не вернул документ');
  if(pending.size)throw Error('Сохранение уже выполняется');
  const requestId=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Нет ответа сервера сохранения'))},60000);
   pending.set(requestId,{resolve,reject,timer});
   window.parent.postMessage({type:'artae-office-save',requestId,blob},origin);
  });
 };
}

function announce(){
 if(started)return;
 if(ready()){
  started=true;
  window.parent.postMessage({type:'artae-office-ready'},origin);
 }else setTimeout(announce,100);
}
addEventListener('message',async event=>{
 if(event.origin!==origin||event.source!==window.parent)return;
 const msg=event.data;
 if(!msg)return;
 if(msg.type==='artae-office-save-result'){
  const p=saveBridge?.pending.get(msg.requestId);
  if(p){clearTimeout(p.timer);saveBridge.pending.delete(msg.requestId);if(msg.ok)p.resolve('saved');else p.reject(Error(String(msg.error||'Не удалось сохранить документ')))}
  return;
 }

 if(msg.type==='artae-office-save-command'){
  try{if(!ready()||typeof window.L.app.save!=='function')throw Error('Сохранение недоступно');await window.L.app.save()}
  catch(error){window.parent.postMessage({type:'artae-office-error',message:String(error?.message||error)},origin)}
  return;
 }
 if(msg.type==='artae-office-close'){
  try{
   if(document.documentElement.dataset.app!=='quire'||!ready()||typeof window.L.app.closeDocument!=='function')
    throw Error('Безопасное закрытие недоступно');
   const closed=await window.L.app.closeDocument();
   if(closed===true)installSaveBridge('',false);
   window.parent.postMessage({type:'artae-office-close-result',closed:closed===true},origin);
  }catch(error){
   window.parent.postMessage({type:'artae-office-close-result',closed:false,error:String(error?.message||error)},origin);
  }
  return;
 }
 if(msg.type==='artae-office-export-pdf'){
  try{
   if(!ready())throw Error('Редактор ещё не готов');
   const kind=document.documentElement.dataset.app;
   const blob=kind==='quire'?await window.L.app.buildPDF():
    kind==='ledger'?await window.L.print.exportPDF({what:'workbook',returnBlob:true}):null;
   if(!(blob instanceof Blob)||blob.type!=='application/pdf')throw Error('Экспорт PDF не вернул документ');
   if(blob.size>60*1024*1024)throw Error('PDF превышает 60 МБ');
   window.parent.postMessage({type:'artae-office-pdf',blob},origin);
  }catch(error){window.parent.postMessage({type:'artae-office-error',message:String(error?.message||error)},origin)}
  finally{window.L?.ui?.busy?.(false)}
  return;
 }
 if(msg.type!=='artae-office-open')return;
 if(!ready()){window.parent.postMessage({type:'artae-office-error',message:'Редактор ещё не готов'},origin);return}
 const expected=document.documentElement.dataset.app==='quire'?'.docx':'.xlsx';
 if(typeof msg.name!=='string'||!msg.name.toLowerCase().endsWith(expected)||!(msg.buffer instanceof ArrayBuffer)||msg.buffer.byteLength>3*1024*1024)return;
 try{
  const file=new File([msg.buffer],msg.name,{type:expected==='.docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  await window.L.app.openFile(file);
  installSaveBridge(msg.name,msg.remoteSave===true);
  window.parent.postMessage({type:'artae-office-opened'},origin);
 }catch(error){
  window.parent.postMessage({type:'artae-office-error',message:String(error?.message||error)},origin);
 }
});
if(document.readyState==='complete')announce();else addEventListener('load',announce,{once:true});
})();
