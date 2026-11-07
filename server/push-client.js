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
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),9000);
 try{
  const res=await fetch(API+(body?'':'?'+new URLSearchParams({action,...(action==='status'?{endpoint:request.endpoint}: {})})),
   {...opts,signal:controller.signal});
  const json=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(json.error||'Ошибка Push (HTTP '+res.status+')');
  return json;
 }catch(error){
  if(error?.name==='AbortError')throw Error('Push API не ответил за 9 секунд');
  throw error;
 }finally{clearTimeout(timeout)}
}
function keyBytes(base64){
 const base=base64.replace(/-/g,'+').replace(/_/g,'/');
 const raw=atob(base.padEnd(Math.ceil(base.length/4)*4,'='));
 return Uint8Array.from(raw,ch=>ch.charCodeAt(0));
}
async function registration(create=false){
 // getRegistration() works without a controlling worker. ready may never resolve
 // if installation failed, so never await ready in the status-checking UI.
 let reg=await navigator.serviceWorker.getRegistration();
 if(!reg&&create)reg=await navigator.serviceWorker.register('/sw.js');
 if(!reg)return null;
 if(!create||reg.active)return reg;
 return Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_,reject)=>setTimeout(()=>reject(Error(
   'Service Worker не активировался. Закройте и снова откройте PWA.')),10000))
 ]);
}
async function currentSubscription(){
 const reg=await registration(false);
 return reg?.active?reg.pushManager.getSubscription():null;
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
 function stateButtons(){
  const canUse=!!config?.enabled;
  enable.hidden=enabled;
  disable.hidden=!enabled;
  test.hidden=!enabled;
  enable.disabled=busy||!canUse;
  disable.disabled=busy||!enabled;
  test.disabled=busy||!enabled;
 }
 async function sync(){
  if(busy)return;
  if(!supported()){
   status.textContent='Этот браузер не поддерживает системные Push-уведомления.';
   row.hidden=true;return;
  }
  if(isIOS()&&!standalone()){
   status.textContent='На iPhone добавьте АРТ-АЕ на экран «Домой» и откройте оттуда.';
   row.hidden=true;return;
  }
  row.hidden=false;
  status.textContent='Проверяем поддержку уведомлений…';
  // Keep the opt-in control responsive while the server and worker are checked.
  enable.disabled=false;disable.disabled=true;test.disabled=true;
  try{
   config=await request('config');
   if(!config.enabled){
    status.textContent='Сервер ещё не активировал Push. Проверьте VAPID в systemd.';
    return;
   }
   const sub=await Promise.race([
    currentSubscription(),
    new Promise((_,reject)=>setTimeout(()=>reject(Error(
     'Не удалось проверить Service Worker за 8 секунд')),8000))
   ]);
   if(sub){
    request.endpoint=sub.endpoint;
    enabled=!!(await request('status')).subscribed;
   }else enabled=false;
   status.textContent=enabled?'Уведомления включены':'Уведомления выключены';
  }catch(error){
   status.textContent='Проверка Push: '+String(error?.message||error);
  }finally{if(!busy)stateButtons()}
 }
 async function enablePush(){
  if(busy)return;
  busy=true;
  stateButtons();
  try{
   if(!supported())throw Error('Браузер не поддерживает Push');
   // Prompt immediately on the user click (mandatory for iOS).
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   if(permission!=='granted')throw Error('Разрешение на уведомления не предоставлено');
   config=config?.publicKey?config:await request('config');
   if(!config.publicKey)throw Error('На сервере отсутствует открытый VAPID-ключ');
   status.textContent='Подключаем устройство…';
   const reg=await registration(true);
   if(!reg)throw Error('Не удалось зарегистрировать Service Worker');
   const subscription=(await reg.pushManager.getSubscription())||
    await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});
   await request('subscribe',{subscription:subscription.toJSON()});
   status.textContent='Уведомления включены';
   enabled=true;
  }catch(error){status.textContent=String(error?.message||error)}
  finally{
   busy=false;
   stateButtons();
  }
 }
 async function disablePush(){
  if(busy)return;
  busy=true;stateButtons();
  try{
   const sub=await currentSubscription();
   if(sub){
    await request('unsubscribe',{endpoint:sub.endpoint});
    await sub.unsubscribe();
   }
   enabled=false;
   status.textContent='Уведомления выключены';
  }catch(error){status.textContent=String(error?.message||error)}
  finally{busy=false;stateButtons()}
 }
 async function testPush(){
  if(busy)return;
  busy=true;stateButtons();
  try{
   const sub=await currentSubscription();
   if(!sub)throw Error('Уведомления выключены');
   await request('test',{subscription:sub.toJSON()});
   status.textContent='Тест отправлен — проверьте системные уведомления';
  }catch(error){status.textContent=String(error?.message||error)}
  finally{busy=false;stateButtons()}
 }
 enable.addEventListener('click',()=>{void enablePush()});
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
