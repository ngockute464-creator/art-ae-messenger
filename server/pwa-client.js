// ART-AE PWA: automatic version checks with reload only at a safe point.
// Messages, unsent drafts and active Office editors remain under app control.
(()=>{
'use strict';
let installPrompt=null,dialog=null,notice=null,newest=null,checkPromise=null,updating=false;
let lastCheck=0,lastInteraction=Date.now();
const build=document.querySelector('meta[name="artae-build"]')?.content||'';
const currentVersion=document.querySelector('meta[name="artae-version"]')?.content||'предыдущая сборка';
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const validHash=x=>typeof x==='string'&&/^[a-f0-9]{40}$/i.test(x);
const newerAvailable=()=>!!(newest&&validHash(newest.build)&&validHash(build)&&newest.build!==build);
const el=(tag,cls,value)=>{
 const e=document.createElement(tag);
 if(cls)e.className=cls;
 if(value)e.textContent=value;
 return e;
};
function appSafe(){
 if(typeof window.ARTAE_CAN_AUTO_RELOAD!=='function')return false;
 try{return !!window.ARTAE_CAN_AUTO_RELOAD()}catch{return false}
}
function removeNotice(){if(notice){notice.remove();notice=null}}
function pendingNotice(){
 if(notice||!newerAvailable())return;
 notice=el('div','artaePwaUpdatePending','Доступна новая версия. Она установится после завершения текущей работы.');
 notice.setAttribute('role','status');
 document.body.append(notice);
}
function updateDialogStatus(){
 if(!dialog)return;
 const status=dialog.querySelector('.artaePwaUpdateStatus');
 const button=dialog.querySelector('.artaePwaUpgrade');
 if(!status||!button)return;
 if(!newest){
  status.textContent='Проверка обновлений…';button.hidden=true;return;
 }
 if(!validHash(build)){
  status.textContent='Для включения автоматических обновлений один раз перезапустите приложение через «Обновить кэш».';
  button.hidden=true;return;
 }
 if(!newerAvailable()){
  status.textContent='Установлена актуальная версия';
  button.hidden=true;return;
 }
 status.textContent=appSafe()?'Доступно обновление '+newest.version:
  'Новая версия готова. Завершите ввод или редактирование, затем она установится автоматически.';
 button.hidden=false;button.disabled=!appSafe();
}
function maybeUpdate(){
 if(updating||!newerAvailable()||document.hidden)return;
 if(!appSafe()){
  pendingNotice();updateDialogStatus();return;
 }
 removeNotice();
 // Do not unexpectedly navigate while the user is clicking, typing or scrolling.
 if(dialog||Date.now()-lastInteraction<8000)return;
 updating=true;
 void (async()=>{
  try{
   if('serviceWorker' in navigator){
    const reg=await navigator.serviceWorker.getRegistration();
    if(reg)await Promise.race([reg.update(),new Promise(resolve=>setTimeout(resolve,4000))]);
   }
  }catch(error){console.warn('ART-AE PWA: service worker update',error)}
  if(document.hidden||!appSafe()){
   updating=false;pendingNotice();return;
  }
  const target=new URL(location.href);
  // Bypasses old cache-first HTML on the one-time transition to the new worker.
  target.searchParams.set('app_build',newest.build.slice(0,12));
  location.replace(target.toString());
 })();
}
async function refreshVersion(force=false){
 if(checkPromise)return checkPromise;
 if(!force&&Date.now()-lastCheck<30000)return;
 lastCheck=Date.now();
 checkPromise=(async()=>{
  try{
   const response=await fetch('/app-version.json?check='+Date.now(),{
    cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}
   });
   if(!response.ok)throw Error('HTTP '+response.status);
   const version=await response.json();
   if(!validHash(version?.build)||typeof version.version!=='string')
    throw Error('Invalid release metadata');
   newest=version;
   if(newerAvailable()){
    if('serviceWorker' in navigator){
     navigator.serviceWorker.getRegistration().then(reg=>reg?.update()).catch(()=>{});
    }
    maybeUpdate();
   }else removeNotice();
   updateDialogStatus();
  }catch(error){
   if(dialog?.querySelector('.artaePwaUpdateStatus'))
    dialog.querySelector('.artaePwaUpdateStatus').textContent='Не удалось проверить обновления';
   console.warn('ART-AE PWA: version check',error.message);
  }
 })();
 try{return await checkPromise}finally{checkPromise=null}
}
async function refreshAppCache(button){
 if(!navigator.onLine){alert('Для обновления необходимо подключение к сети.');return}
 if(!confirm('Перезагрузить АРТ-АЕ и обновить кэш? Несохранённый текст в открытой форме может быть потерян.'))return;
 button.disabled=true;button.textContent='Обновление…';
 try{
  if('caches' in window){
   const keys=await caches.keys();
   await Promise.all(keys.filter(key=>key.startsWith('art-ae-')).map(key=>caches.delete(key)));
  }
  if('serviceWorker' in navigator){
   const reg=await navigator.serviceWorker.getRegistration();
   if(reg)await reg.update();
  }
  const target=new URL(location.href);
  target.searchParams.set('app_build',Date.now().toString(36));
  location.replace(target.toString());
 }catch(error){
  button.disabled=false;button.textContent='Обновить кэш';
  alert('Не удалось обновить кэш: '+String(error.message||error));
 }
}
function closeDialog(){
 if(!dialog)return;
 dialog.remove();dialog=null;
 document.removeEventListener('keydown',onKey);
 lastInteraction=Date.now();
}
function onKey(e){if(e.key==='Escape'&&dialog)closeDialog()}
function showAppInfo(){
 closeDialog();
 dialog=el('div','artaePwaBackdrop');
 dialog.setAttribute('role','presentation');
 const panel=el('section','artaePwaDialog');
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 panel.setAttribute('aria-label','Приложение АРТ-АЕ');
 const h=el('div','artaePwaHead'),title=el('h2','','Приложение'),
  close=el('button','artaePwaClose','×');
 close.type='button';close.setAttribute('aria-label','Закрыть');close.addEventListener('click',closeDialog);
 h.append(title,close);panel.append(h);
 panel.append(el('p','artaePwaStatus',isStandalone()?'Запущено как приложение':'Открыто в браузере'));
 if(isStandalone())panel.append(el('p','artaePwaHint','АРТ-АЕ уже открыт в отдельном окне приложения.'));
 else if(installPrompt){
  const btn=el('button','artaePwaInstall','Установить АРТ-АЕ');btn.type='button';
  btn.addEventListener('click',async()=>{
   const prompt=installPrompt;installPrompt=null;closeDialog();
   try{await prompt.prompt();await prompt.userChoice}catch{}
  });
  panel.append(btn);
 }else if(isIOS()){
  panel.append(el('p','artaePwaHint','В Safari нажмите «Поделиться», затем «На экран Домой».'));
 }else{
  panel.append(el('p','artaePwaHint','Для установки используйте команду браузера «Установить приложение».'));
 }
 panel.append(el('p','artaePwaSmall','Версия: '+currentVersion+(validHash(build)?' · '+build.slice(0,8):'')));
 const versionLine=el('p','artaePwaSmall artaePwaUpdateStatus','Проверка обновлений…');
 panel.append(versionLine);
 const upgrade=el('button','artaePwaInstall artaePwaUpgrade','Обновить приложение');
 upgrade.type='button';upgrade.hidden=true;
 upgrade.addEventListener('click',()=>{
  if(!appSafe()){updateDialogStatus();return}
  closeDialog();
  lastInteraction=Date.now()-10000;
  maybeUpdate();
 });
 panel.append(upgrade);
 const reload=el('button','artaePwaCacheButton','Обновить кэш');
 reload.type='button';reload.addEventListener('click',()=>refreshAppCache(reload));panel.append(reload);
 panel.append(el('p','artaePwaSmall','Ручная очистка кэша требуется только при неполадках. Серверные сообщения и файлы не удаляются.'));
 dialog.append(panel);
 dialog.addEventListener('click',e=>{if(e.target===dialog)closeDialog()});
 document.body.append(dialog);document.addEventListener('keydown',onKey);
 close.focus();
 updateDialogStatus();
 void refreshVersion(true);
}
document.addEventListener('click',event=>{
 const target=event.target.closest?.('[data-act="appInstallInfo"]');
 if(!target)return;
 event.preventDefault();event.stopImmediatePropagation();showAppInfo();
},true);
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event});
window.addEventListener('appinstalled',()=>{installPrompt=null;if(dialog)showAppInfo()});
for(const type of ['pointerdown','keydown','wheel','touchstart']){
 document.addEventListener(type,()=>{lastInteraction=Date.now()},{capture:true,passive:true});
}
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden){void refreshVersion(true);maybeUpdate()}
});
window.addEventListener('focus',()=>{void refreshVersion()});
window.addEventListener('online',()=>{void refreshVersion(true)});
window.addEventListener('pageshow',()=>{void refreshVersion()});
if('serviceWorker' in navigator){
 navigator.serviceWorker.addEventListener('controllerchange',()=>{maybeUpdate()});
}
setInterval(()=>{
 if(!document.hidden){
  if(newerAvailable())maybeUpdate();
  else void refreshVersion();
 }
},2000);
const start=()=>{setTimeout(()=>{void refreshVersion(true)},3000)};
if(document.readyState==='complete')start();
else window.addEventListener('load',start,{once:true});
const style=el('style');
style.textContent=[
 '.artaePwaBackdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:#0008}',
 '.artaePwaDialog{width:min(420px,100%);max-height:90dvh;overflow:auto;border-radius:16px;background:var(--surface,#fff);color:var(--text,#17243a);padding:22px;box-shadow:0 20px 55px #0004}',
 '.artaePwaHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.artaePwaHead h2{font:600 21px/1.25 system-ui;margin:0 0 16px}',
 '.artaePwaClose{border:0;background:transparent;color:inherit;font-size:28px;min-width:40px;min-height:40px;cursor:pointer}',
 '.artaePwaStatus{font-weight:650;font-size:15px;margin:8px 0 14px}.artaePwaHint{font-size:14px;line-height:1.5;margin:0 0 12px}',
 '.artaePwaInstall{display:block;width:100%;border:0;border-radius:10px;background:#2769cc;color:#fff;font:600 15px system-ui;padding:13px;cursor:pointer}',
 '.artaePwaInstall:disabled{opacity:.55;cursor:not-allowed}.artaePwaSmall{font-size:12px;line-height:1.4;opacity:.7;margin:13px 0 0}',
 '.artaePwaCacheButton{margin-top:12px;width:100%;border:1px solid #bdc9db;background:transparent;color:inherit;border-radius:10px;padding:12px;font:600 14px system-ui;cursor:pointer}',
 '.artaePwaUpdatePending{position:fixed;z-index:99980;bottom:max(18px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);max-width:min(480px,calc(100vw - 24px));padding:11px 16px;border-radius:12px;background:var(--surface,#fff);color:var(--text,#17243a);box-shadow:0 5px 28px #0003;border:1px solid #bdc9db;font:13px/1.45 system-ui;pointer-events:none;text-align:center}'
].join('\n');
document.head.append(style);
})();
