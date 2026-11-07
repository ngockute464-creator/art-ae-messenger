// Build-time push UI + SW composition. Never hand-edit generated public/sw.js.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const file='public/index.html',pwa='public/pwa-client.js',appFile='public/app.js',swFile='public/sw.js';
let html=readFileSync(file,'utf8');
if(!html.includes('<script src="pwa-client.js" defer></script>'))throw Error('Push: PWA script marker missing');
html=html.replace('<script src="pwa-client.js" defer></script>',
 '<script src="pwa-client.js" defer></script><script src="push-client.js" defer></script>');
writeFileSync(file,html);
copyFileSync('server/push-client.js','public/push-client.js');
let client=readFileSync(pwa,'utf8');
const placement="const reload=el('button','artaePwaCacheButton','Обновить кэш');";
if(!client.includes(placement))throw Error('Push: PWA dialogue anchor mismatch');
client=client.replace(placement,"if(typeof window.ARTAE_PUSH_MOUNT==='function')window.ARTAE_PUSH_MOUNT(panel);\n "+placement);
writeFileSync(pwa,client);
let app=readFileSync(appFile,'utf8');
const anchor='function cp(){';
if(app.split(anchor).length!==2)throw Error('Push: app navigation anchor mismatch');
const route=String.raw`
window.ARTAE_OPEN_PUSH_CONVERSATION=id=>{
 try{
  if(!syncReady||!data.convos.some(c=>c.id===id))return false;
  // Keep persistent text drafts; defer navigation only during active edits/uploads.
  if((typeof editing!=='undefined'&&editing)||(typeof modal!=='undefined'&&modal)||
     (typeof voiceDraft!=='undefined'&&voiceDraft)||
     (typeof chatSending!=='undefined'&&chatSending.size)||
     (typeof explorerUploading!=='undefined'&&explorerUploading)||
     document.querySelector('.artaeOfficeOverlay,.artaeOfficeWarmActive,.messageEdit'))return false;
  const found=data.convos.find(c=>c.id===id);
  project=found.project;
  openChat(found.id);
  saveWorkplace();
  return true;
 }catch(error){console.warn('ART-AE Push open:',error);return false}
};
`;
app=app.replace(anchor,route+'\n'+anchor);
writeFileSync(appFile,app);
let sw=readFileSync(swFile,'utf8');
const marker="'./pwa-client.js','./office-client.js'";
if(!sw.includes(marker))throw Error('Push: worker cache list changed');
sw=sw.replace(marker,"'./pwa-client.js','./push-client.js','./office-client.js'");
sw+=String.raw`
self.addEventListener('push',event=>{
 let info={};
 try{info=event.data?.json()||{}}catch{}
 // Apple requires every delivered Web Push to present a visible notification.
 const convo=typeof info.conversation==='string'&&/^[0-9a-f-]{36}$/i.test(info.conversation)
  ?info.conversation:null;
 event.waitUntil(self.registration.showNotification('АРТ-АЕ',{
  body:convo?'Новое сообщение':'Проверка уведомлений',
  icon:'/icon.svg',
  tag:convo?'artae-convo-'+convo:'artae-push-test',
  data:{conversation:convo}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const convo=event.notification.data?.conversation||null;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const same=windows.filter(client=>new URL(client.url).origin===self.location.origin);
  const selected=same.find(c=>c.focused)||same[0];
  if(selected){
   await selected.focus();
   if(convo)selected.postMessage({type:'ARTAE_PUSH_OPEN',conversation:convo});
  }else{
   const path=convo?'/?push_convo='+encodeURIComponent(convo):'/';
   await self.clients.openWindow(path);
  }
 })());
});
`;
writeFileSync(swFile,sw);
console.log('ART-AE: optional Web Push controls and notification navigation');
