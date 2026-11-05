// ART-AE file handoff. No authentication tokens are sent to the office frame.
(() => {
'use strict';
const origin=location.origin;
const ready=()=>window.L&&window.L.app&&typeof window.L.app.openFile==='function';
let started=false;
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
 if(msg.type==='artae-office-close'){
  try{
   if(document.documentElement.dataset.app!=='quire'||!ready()||typeof window.L.app.closeDocument!=='function')
    throw Error('Безопасное закрытие недоступно');
   const closed=await window.L.app.closeDocument();
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
  window.parent.postMessage({type:'artae-office-opened'},origin);
 }catch(error){
  window.parent.postMessage({type:'artae-office-error',message:String(error?.message||error)},origin);
 }
});
if(document.readyState==='complete')announce();else addEventListener('load',announce,{once:true});
})();
