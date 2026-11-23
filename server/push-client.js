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
async function withTimeout(promise,ms,error){
 let timer;
 try{
  return await Promise.race([promise,new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error(error)),ms);
  })]);
 }finally{clearTimeout(timer)}
}
async function registration(create=false){
 // getRegistration() works without a controlling worker. ready may never resolve
 // if installation failed, so never await ready in the status-checking UI.
 let reg=await withTimeout(navigator.serviceWorker.getRegistration(),8000,'Service Worker не отвечает');
 if(!reg&&create)reg=await navigator.serviceWorker.register('/sw.js');
 if(!reg)return null;
 if(!create||reg.active)return reg;
 return withTimeout(navigator.serviceWorker.ready,10000,
  'Service Worker не активировался. Закройте и снова откройте PWA.');
}
async function currentSubscription(){
 const reg=await registration(false);
 return reg?.active?withTimeout(reg.pushManager.getSubscription(),8000,
  'Push Manager не отвечает'):null;
}
// Push is recommended by default, but never bypasses browser permission.
const PUSH_OPT_OUT='artae_push_explicitly_disabled_v1';
// 'Not now' is session-only. Legacy persisted suppression must not survive restarts.
const PUSH_OLD_DISMISS_KEY='artae_push_prompt_dismissed_v1';
try{localStorage.removeItem(PUSH_OLD_DISMISS_KEY)}catch{}
const pushChoice=key=>{try{return localStorage.getItem(key)==='1'}catch{return false}};
const savePushChoice=(key,value)=>{try{if(value)localStorage.setItem(key,'1');else localStorage.removeItem(key)}catch{}};
async function establishPush(){
 const config=await request('config');
 if(!config?.enabled||!config.publicKey)throw Error('На сервере не настроены Push-уведомления');
 const reg=await registration(true);
 if(!reg)throw Error('Service Worker недоступен');
 const existing=await withTimeout(reg.pushManager.getSubscription(),8000,'Push Manager не отвечает');
 if(existing){
  request.endpoint=existing.endpoint;
  if((await request('status')).subscribed)return existing;
 }
 const subscription=existing||await withTimeout(reg.pushManager.subscribe({
  userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)
 }),12000,'Не удалось создать Push-подписку');
 await request('subscribe',{subscription:subscription.toJSON()});
 return subscription;
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
   const sub=await currentSubscription();
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
   status.textContent='Подключаем устройство…';
   await establishPush();
   savePushChoice(PUSH_OPT_OUT,false);
   pushDeferredForSession=false;
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
   savePushChoice(PUSH_OPT_OUT,true);
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
// Initial push state must never fail silently: show a recoverable status when
// the server or subscription fails, but never request permission without a click.
let pushWelcomeShown=false,pushDeferredForSession=false,pushAutoBusy=false,pushAutoReady=false;
let pushWelcomeMode=null,pushWelcomeDetail='';
function removePushWelcome(){
 document.querySelector?.('#artaePushWelcome')?.remove?.();
 pushWelcomeMode=null;pushWelcomeDetail='';
}
function createPushWelcome(mode='invite',detail=''){
 if(pushDeferredForSession||pushChoice(PUSH_OPT_OUT))return;
 if(!document.createElement||!document.body)return;
 const previous=document.querySelector?.('#artaePushWelcome');
 if(previous&&pushWelcomeMode===mode&&(mode==='invite'||pushWelcomeDetail===detail))return;
 if(previous)previous.remove();
 pushWelcomeShown=true;pushWelcomeMode=mode;pushWelcomeDetail=detail;
 const box=document.createElement('div');box.id='artaePushWelcome';
 box.setAttribute('role','region');box.setAttribute('aria-label','Уведомления');
 const message=document.createElement('span');
 message.textContent=mode==='invite'
  ?'Получать уведомления о новых сообщениях?'
  :'Уведомления не подключены: '+(detail||'не удалось проверить настройки');
 const yes=document.createElement('button');yes.type='button';
 yes.textContent=mode==='invite'?'Включить':'Повторить';
 const later=document.createElement('button');later.type='button';later.textContent='Не сейчас';
 box.append(message,yes,later);
 yes.addEventListener('click',()=>{
  if(mode!=='invite'){
   removePushWelcome();
   void offerDefaultPush(true);
   return;
  }
  // The system prompt MUST be called synchronously from this click.
  const approval=Notification.permission==='granted'
   ?Promise.resolve('granted'):Notification.requestPermission();
  void Promise.resolve(approval).then(async permission=>{
   if(permission!=='granted'){
    pushDeferredForSession=true;removePushWelcome();return;
   }
   message.textContent='Подключаем уведомления…';
   yes.disabled=true;
   try{
    await establishPush();
    pushAutoReady=true;
    savePushChoice(PUSH_OPT_OUT,false);
    pushDeferredForSession=false;
    removePushWelcome();
   }catch(error){
    createPushWelcome('error',String(error?.message||error));
   }
  }).catch(error=>createPushWelcome('error',String(error?.message||error)));
 });
 later.addEventListener('click',()=>{
  pushDeferredForSession=true;
  removePushWelcome();
 });
 document.body.append(box);
}
async function offerDefaultPush(force=false){
 if(pushAutoReady||pushAutoBusy||!supported()||pushChoice(PUSH_OPT_OUT))return;
 if(isIOS()&&!standalone())return;
 // Authentication renders .app. Avoid permission/config requests on the login screen.
 if(!document.querySelector?.('.app')||document.hidden)return;
 if(Notification.permission==='denied'){removePushWelcome();return}
 if(pushDeferredForSession&&!force)return;
 pushAutoBusy=true;
 try{
  if(Notification.permission==='granted'){
   await establishPush();pushAutoReady=true;removePushWelcome();
  }else{
   // Check VAPID before recommending permission. An unavailable service must
   // be visible instead of silently suppressing the entire invitation.
   const config=await request('config');
   if(!config?.enabled||!config.publicKey)
    createPushWelcome('error','сервер Push пока не настроен');
   else createPushWelcome('invite');
  }
 }catch(error){
  console.warn('ART-AE default push:',error?.message||error);
  createPushWelcome('error',String(error?.message||error));
 }finally{pushAutoBusy=false}
}
// The first attempt should run as soon as the authenticated shell exists;
// a periodic fallback covers delayed login and application startup on mobiles.
setTimeout(()=>{void offerDefaultPush()},1200);
setInterval(()=>{void offerDefaultPush()},5000);
if(typeof MutationObserver!=='undefined'){
 const observer=new MutationObserver(()=>{
  if(!document.querySelector?.('.app')){pushAutoReady=false;return}
  if(!pushAutoReady&&!pushWelcomeMode)void offerDefaultPush();
 });
 observer.observe(document.body,{childList:true,subtree:false});
}
const welcomeStyle=document.createElement('style');
welcomeStyle.textContent='#artaePushWelcome{position:fixed;left:50%;top:75px;transform:translateX(-50%);z-index:10000;display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:12px 15px;width:max-content;max-width:calc(100vw - 28px);box-sizing:border-box;border:1px solid #c9d8ec;border-radius:12px;background:#fff;color:#24354b;box-shadow:0 7px 25px #2233;font:14px system-ui}#artaePushWelcome span{flex:1 1 170px}#artaePushWelcome button{border:1px solid #bed0e9;border-radius:7px;background:#eef5ff;color:#245eaa;padding:8px 12px;cursor:pointer}';
document.head.append(welcomeStyle);

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
