// Protect an actively edited message from unrelated full-app rerenders.
// Polling of pins/files and some async status updates call render(), which
// replaces #draft and loses mobile keyboard focus and the IME composition.
let composerFocusedSession=null;
let composerDeferredRender=false;
const composerUnprotectedRender=render;
function composerProtectsFocus(){
 const active=document.activeElement;
 const field=active?.id==='draft'&&active?.isConnected?active:null;
 if(field&&view==='chat'&&!modal&&!editing)
  composerFocusedSession={field,project,convo,composing:!!composerFocusedSession?.composing};
 const session=composerFocusedSession;
 return !!session&&view==='chat'&&project===session.project&&convo===session.convo&&
  !modal&&!editing&&session.field.isConnected&&
  root.querySelector('#draft')===session.field&&
  (document.activeElement===session.field||session.composing);
}
render=function(...args){
 if(composerProtectsFocus()){
  // Message syncing updates #msgscroll separately. Do not replace the editor
  // while text entry is active; flush the visual changes after genuine blur.
  composerDeferredRender=true;
  return;
 }
 composerDeferredRender=false;
 return composerUnprotectedRender.apply(this,args);
};
root.addEventListener('focusin',event=>{
 if(event.target?.id==='draft'&&view==='chat')
  composerFocusedSession={field:event.target,project,convo,composing:false};
},true);
root.addEventListener('compositionstart',event=>{
 if(event.target?.id==='draft'&&composerFocusedSession?.field===event.target)
  composerFocusedSession.composing=true;
},true);
root.addEventListener('compositionend',event=>{
 if(event.target?.id==='draft'&&composerFocusedSession?.field===event.target)
  composerFocusedSession.composing=false;
},true);
root.addEventListener('focusout',event=>{
 const session=composerFocusedSession;
 if(event.target?.id!=='draft'||session?.field!==event.target)return;
 composerFocusedSession=null;
 // Avoid detaching the clicked send/attachment button between pointerup and
 // click; wait until the interaction has completed.
 setTimeout(()=>{
  if(!composerDeferredRender||view!=='chat'||convo!==session.convo||
     project!==session.project||modal||editing||
     document.activeElement?.id==='draft')return;
  composerDeferredRender=false;
  composerUnprotectedRender();
 },240);
},true);
