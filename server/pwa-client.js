// PWA installation and launch mode, kept outside the authenticated app state.
(()=>{
'use strict';
let installPrompt=null;
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const inBrowser=()=>!isStandalone();
const build=document.querySelector('meta[name="artae-build"]')?.content||'';
const currentVersion=document.querySelector('meta[name="artae-version"]')?.content||'предыдущая сборка';
let newest=null;
async function refreshVersion(){
 try{
  const response=await fetch('/app-version.json',{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const result=await response.json();
  if(!result||typeof result.build!=='string'||!result.build)throw Error('Invalid build');
  newest=result;
  if(!build||build==='preview')return {status:'Текущая версия не определена; доступна '+result.version,newer:false};
  if(result.build===build)return {status:'Установлена актуальная версия',newer:false};
  return {status:'Доступна версия '+result.version+' · '+result.build.slice(0,8),newer:true};
 }catch{return {status:'Не удалось проверить обновления',newer:false}}
}
async function activateUpdate(){
 if(!newest)return;
 const btn=dialog?.querySelector('.artaePwaInstall');if(btn)btn.disabled=true;
 try{
  const reg=await navigator.serviceWorker?.getRegistration();
  await reg?.update();
 }catch{}
 // Bust cache-first HTML and JS requests without clearing user data.
 const url=new URL(location.href);url.searchParams.set('app_build',newest.build.slice(0,12));
 location.assign(url.pathname+url.search+url.hash);
}
const t=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e;};
let dialog=null;
function closeDialog(){if(!dialog)return;const old=dialog;dialog=null;old.remove();}
function showAppInfo(){
 closeDialog();
 dialog=t('div','artaePwaBackdrop');
 dialog.setAttribute('role','presentation');
 const panel=t('section','artaePwaDialog');
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Приложение АРТ-АЕ');
 const h=t('div','artaePwaHead'),title=t('h2','', 'Приложение'),close=t('button','artaePwaClose','×');
 close.type='button';close.setAttribute('aria-label','Закрыть');
 close.addEventListener('click',closeDialog);
 h.append(title,close);panel.append(h);
 const status=t('p','artaePwaStatus',isStandalone()?'Запущено как приложение':'Открыто в браузере');
 panel.append(status);
 if(isStandalone())panel.append(t('p','artaePwaHint','АРТ-АЕ уже открыт в отдельном окне приложения.'));
 else if(installPrompt){
  const btn=t('button','artaePwaInstall','Установить АРТ-АЕ');btn.type='button';
  btn.addEventListener('click',async()=>{
   const p=installPrompt;installPrompt=null;
   closeDialog();
   try{await p.prompt();await p.userChoice;}catch{}
  });
  panel.append(btn);
 }else if(isIOS()){
  panel.append(t('p','artaePwaHint','В Safari нажмите «Поделиться», затем «На экран Домой» и подтвердите добавление.'));
 }else{
  panel.append(t('p','artaePwaHint','Для установки откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран», если такой пункт доступен.'));
 }
 const explanation=t('p','artaePwaSmall','Статус показывает режим текущего окна. Он не означает, что приложение отсутствует на устройстве.');
 panel.append(explanation);
 const versionLine=t('p','artaePwaSmall','Версия: '+currentVersion+(build?' · '+build.slice(0,8):''));
 panel.append(versionLine);
 const available=t('p','artaePwaSmall','Проверка обновлений…');panel.append(available);
 const upgrade=t('button','artaePwaInstall','Обновить приложение');
 upgrade.type='button';upgrade.hidden=true;upgrade.addEventListener('click',()=>activateUpdate());
 panel.append(upgrade);
 refreshVersion().then(info=>{
   if(dialog?.contains(available)){
     available.textContent=info.status;
     upgrade.hidden=!info.newer;
   }
 }).catch(()=>{if(dialog?.contains(available))available.textContent='Не удалось проверить обновления';});
 dialog.append(panel);
 dialog.addEventListener('click',e=>{if(e.target===dialog)closeDialog()});
 document.addEventListener('keydown',onKey);
 document.body.append(dialog);close.focus();
}
function onKey(e){if(e.key==='Escape'&&dialog){closeDialog();document.removeEventListener('keydown',onKey)}}
document.addEventListener('click',e=>{
 const btn=e.target.closest('[data-act="appInstallInfo"]');if(!btn)return;
 e.preventDefault();e.stopImmediatePropagation();showAppInfo();
},true);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
window.addEventListener('appinstalled',()=>{installPrompt=null;if(dialog)showAppInfo()});
const styles=t('style');styles.textContent=`
.artaePwaBackdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;background:#0008}
.artaePwaDialog{width:min(420px,100%);max-height:90dvh;overflow:auto;border-radius:16px;background:var(--surface,#fff);color:var(--text,#17243a);padding:22px;box-shadow:0 20px 55px #0004}
.artaePwaHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.artaePwaHead h2{font:600 21px/1.25 system-ui;margin:0 0 16px}
.artaePwaClose{border:0;background:transparent;color:inherit;font-size:28px;min-width:40px;min-height:40px;cursor:pointer}
.artaePwaStatus{font-weight:650;font-size:15px;margin:8px 0 14px}.artaePwaHint{font-size:14px;line-height:1.5;margin:0 0 12px}
.artaePwaInstall{display:block;width:100%;border:0;border-radius:10px;background:#2769cc;color:#fff;font:600 15px system-ui;padding:13px;cursor:pointer}
.artaePwaSmall{font-size:12px;line-height:1.4;opacity:.7;margin:13px 0 0}
`;
document.head.append(styles);
})();
