// ART-AE push opt-in and notification navigation. No external SDK or credentials.
(()=>{
'use strict';
const API='/.netlify/functions/push';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const supported=()=> 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
async function request(action,body){
 const opts=body?{method:'POST',credentials:'same-origin',cache:'no-store',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body})}:
  {credentials:'same-origin',cache:'no-store'};
 const res=await fetch(API+(body?'':'?'+new URLSearchParams({action,...(action==='status'?{endpoint:request.endpoint}: {})})),opts);
 const json=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(json.error||'Ошибка Push ('+res.status+')');
 return json;
}
function keyBytes(base64){
 const base=base64.replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(base.padEnd(Math.ceil(base.length/4)*4,'='));
 return Uint8Array.from(raw,ch=>ch.charCodeAt(0));
}
async function registration(){
 let reg=await navigator.serviceWorker.getRegistration();
 if(!reg)reg=await navigator.serviceWorker.register('/sw.js');
 return navigator.serviceWorker.ready;
}
async function currentSubscription(){
 const reg=await registration();
 return reg.pushManager.getSubscription();
}
function mountPush(panel){
 const label=document.createElement('p');label.className='artaePwaSmall';
 label.textContent='Уведомления';panel.append(label);
 const status=document.createElement('p');status.className='artaePwaSmall';panel.append(status);
 const row=document.createElement('div');row.className='artaePushControls';
 const enable=document.createElement('button'),disable=document.createElement('button'),
  test=document.createElement('button');
 for(const b of [enable,disable,test]){b.type='button';b.className='artaePwaCacheButton';row.append(b)}
 enable.textContent='Включить';disable.textContent='Выключить';test.textContent='Тест';
 panel.append(row);
 let enabled=false,config=null,busy=false;
 async function sync(){
  if(busy)return;
  if(!supported()){
   status.textContent='Уведомления не поддерживаются этим браузером.';
   row.hidden=true;return;
  }
  if(isIOS()&&!standalone()){
   status.textContent='На iPhone сначала добавьте АРТ-АЕ на экран «Домой» и откройте его оттуда.';
   row.hidden=true;return;
  }
  row.hidden=false;enable.disabled=true;disable.disabled=true;test.disabled=true;
  try{
   config=await request('config');
   if(!config.enabled){status.textContent='Push ещё не настроен на сервере';return}
   const sub=await currentSubscription();
   if(sub){
    request.endpoint=sub.endpoint;
    enabled=(await request('status')).subscribed;
   }else enabled=false;
   status.textContent=enabled?'Уведомления включены':'Уведомления выключены';
   enable.hidden=enabled;disable.hidden=!enabled;test.hidden=!enabled;
  }catch(error){status.textContent=String(error.message||error)}
  finally{enable.disabled=false;disable.disabled=false;test.disabled=false}
 }
 async function enablePush(){
  if(busy)return;
  busy=true;enable.disabled=true;
  try{
   if(!supported())throw Error('Браузер не поддерживает Push');
   // Request browser permission directly from the click handler for iOS.
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   if(permission!=='granted')throw Error('Разрешение на уведомления не предоставлено');
   config=config?.publicKey?config:await request('config');
   if(!config.publicKey)throw Error('Сервер не настроен');
   const reg=await registration();
   const subscription=(await reg.pushManager.getSubscription())||
    await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});
   await request('subscribe',{subscription:subscription.toJSON()});
   status.textContent='Уведомления включены';enabled=true;
  }catch(error){status.textContent=String(error.message||error);enabled=false}
  finally{
   busy=false;enable.disabled=false;enable.hidden=enabled;disable.hidden=!enabled;test.hidden=!enabled;
  }
 }
 async function disablePush(){
  if(busy)return;
  busy=true;
  try{
   const sub=await currentSubscription();
   if(sub){
    await request('unsubscribe',{endpoint:sub.endpoint});
    await sub.unsubscribe();
   }
   enabled=false;status.textContent='Уведомления выключены';
  }catch(error){status.textContent=String(error.message||error)}
  finally{busy=false;enable.hidden=enabled;disable.hidden=!enabled;test.hidden=!enabled}
 }
 async function testPush(){
  if(busy)return;
  busy=true;test.disabled=true;
  try{
   const sub=await currentSubscription();
   if(!sub)throw Error('Уведомления выключены');
   await request('test',{subscription:sub.toJSON()});
   status.textContent='Тест отправлен — проверьте системные уведомления';
  }catch(error){status.textContent=String(error.message||error)}
  finally{busy=false;test.disabled=false}
 }
 enable.addEventListener('click',enablePush);
 disable.addEventListener('click',()=>{void disablePush()});
 test.addEventListener('click',()=>{void testPush()});
 void sync();
}
window.ARTAE_PUSH_MOUNT=mountPush;
const fromUrl=()=>new URL(location.href).searchParams.get('push_convo');
let pending=UUID.test(fromUrl()||'')?fromUrl():null;
function setPending(id){
 if(!UUID.test(id||''))return;
 pending=id;
 openPending();
}
function openPending(){
 if(!pending||typeof window.ARTAE_OPEN_PUSH_CONVERSATION!=='function')return;
 const opened=window.ARTAE_OPEN_PUSH_CONVERSATION(pending);
 if(!opened)return;
 pending=null;
 const url=new URL(location.href);url.searchParams.delete('push_convo');
 history.replaceState(history.state,'',url.pathname+url.search+url.hash);
}
navigator.serviceWorker?.addEventListener('message',event=>{
 if(event.data?.type==='ARTAE_PUSH_OPEN')setPending(event.data.conversation);
});
setInterval(openPending,800);
const style=document.createElement('style');
style.textContent='.artaePushControls{display:flex;gap:7px;margin-top:5px}.artaePushControls .artaePwaCacheButton{flex:1;min-width:0;padding:9px 5px;margin-top:7px;font-size:13px}';
document.head.append(style);
})();
