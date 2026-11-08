// Native DOCX/XLSX viewer protections for the pinned VibeOffice build.
// Hiding menus is insufficient: block model transactions, editing entry points,
// and paste/keyboard modifications. Original project writes also require a
// separate server-side edit lease, which preview never receives.
(() => {
'use strict';
let active=false,kind=null,undo=[];
const destructive=new Set(['Backspace','Delete','F2']);
const shortcutEdits=new Set(['s','x','v','z','y','b','i','u']);
const safeCommands=new Set([
 'find','fileSearch','goTo','nextSheet','prevSheet','selectAll','copy',
 'viewPrint','viewReading','viewNormal','viewWeb','viewOutline',
 'zoomIn','zoomOut','zoom100','zoomPage','zoomWidth','zoomTo',
 'scrollUp','scrollDown','printPreview'
]);
function preventMutation(event){
 if(!active)return;
 // Search/find dialogs must remain fully usable, including Android keyboard.
 // Only the original editor grid / formula surface is locked against typing.
 const target=event.target;
 const tag=target?.tagName;
 const ledgerInput=window.L?.grid?.input;
 if((tag==='INPUT'||tag==='TEXTAREA')&&target!==ledgerInput&&target?.id!=='fbinput')
  return;
 if(event.type==='keydown'){
  const key=event.key||'',ctrl=event.ctrlKey||event.metaKey;
  const block=destructive.has(key)||(ctrl&&shortcutEdits.has(key.toLowerCase()))||
   (!ctrl&&!event.altKey&&!event.metaKey&&key.length===1&&key!==' ');
  if(!block)return;
 }
 if(event.cancelable)event.preventDefault();
 event.stopImmediatePropagation?.();
}
for(const name of ['beforeinput','paste','drop','cut','compositionstart','keydown'])
 document.addEventListener(name,preventMutation,true);
const style=document.createElement('style');
style.textContent=[
 'html[data-artae-office-viewer="1"] .cmdbars,',
 'html[data-artae-office-viewer="1"] .drawrow,',
 'html[data-artae-office-viewer="1"] .taskpane,',
 'html[data-artae-office-viewer="1"] .statusbar,',
 'html[data-artae-office-viewer="1"] .viewbar,',
 'html[data-artae-office-viewer="1"] .revpane,',
 'html[data-artae-office-viewer="1"] .docmap,',
 'html[data-artae-office-viewer="1"] #fbar{display:none!important}',
 'html[data-artae-office-viewer="1"][data-app="quire"] #work{',
 'grid-template-rows:0 1fr!important;grid-template-columns:0 1fr!important}',
 'html[data-artae-office-viewer="1"][data-app="quire"] .r-corner,',
 'html[data-artae-office-viewer="1"][data-app="quire"] .ruler-h,',
 'html[data-artae-office-viewer="1"][data-app="quire"] .ruler-v{display:none!important}',
 'html[data-artae-office-viewer="1"][data-app="ledger"] #main{min-height:0!important}',
 'html[data-artae-office-viewer="1"][data-app="ledger"] #tabrow{display:flex!important}'
].join('\n');
document.head.append(style);
function property(obj,key,next){
 if(!obj)throw Error('VibeOffice API missing: '+key);
 const previous=obj[key];
 undo.push(()=>{obj[key]=previous});
 obj[key]=next;
}
function guard(obj,name,denied){
 if(typeof obj?.[name]!=='function')throw Error('Cannot protect '+name);
 const original=obj[name];
 property(obj,name,function(...args){return active?denied:original.apply(this,args)});
}
function release(){
 if(!active&&!undo.length)return;
 active=false;
 for(let i=undo.length-1;i>=0;i--)try{undo[i]()}catch{}
 undo=[];
 delete document.documentElement.dataset.artaeOfficeViewer;
 kind=null;
}
function activate(next){
 release();
 if(next!=='quire'&&next!=='ledger')throw Error('Unsupported Office kind');
 const L=window.L;
 if(!L?.app||!L?.ui)throw Error('VibeOffice has not initialized');
 try{
  if(next==='quire'){
   const missing=[
    ['app.setView',typeof L.app.setView==='function'],
    ['ed',!!L.ed],['D.tx',typeof L.D?.tx==='function'],
    ['layout.root',!!L.layout?.root]
   ].filter(([,ok])=>!ok).map(([name])=>name);
   if(missing.length)throw Error('Quire read-only API unavailable: '+missing.join(', '));
   const previousView=L.app.view;
   L.app.setView('reading');
   undo.push(()=>{if(L.app.view!==previousView)L.app.setView(previousView||'print')});
   // The built-in reading mode defaults to two pages: one page on Android.
   if(window.matchMedia?.('(max-width: 700px)').matches&&
      typeof L.layout.setMultiPage==='function'){
    L.layout.setMultiPage(0);
    if(typeof L.layout.zoomFor==='function'&&typeof L.layout.setZoom==='function')
     L.layout.setZoom(L.layout.zoomFor('pageWidth'));
   }
   property(L.ed,'readOnly',true);
   property(L.layout.root,'contentEditable','false');
   guard(L.D,'tx',false);
  }else{
   if(!L.ops||!L.grid||!L.editor)throw Error('Ledger view-only API unavailable');
   guard(L.ops,'tx',false);
   guard(L.grid,'guardProtect',true);
   guard(L.editor,'begin',undefined);
   const formula=document.getElementById('fbinput');
   if(formula)property(formula,'readOnly',true);
   const input=L.grid.input;
   if(input)property(input,'readOnly',true);
  }
  guard(L,'saveFile',undefined);
  if(typeof L.ui.exec!=='function')throw Error('VibeOffice commands unavailable');
  const originalExec=L.ui.exec;
  property(L.ui,'exec',function(command,...args){
   if(active&&!safeCommands.has(command))return false;
   return originalExec.call(this,command,...args);
  });
  kind=next;
  document.documentElement.dataset.artaeOfficeViewer='1';
  active=true;
 }catch(e){release();throw e}
}
window.ARTAE_OFFICE_READONLY={activate,release,get active(){return active},get kind(){return kind}};
})();
