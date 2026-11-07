// ART-AE composer: a single input, attachment button and one contextual action.
// This file runs in the existing app closure, without rerendering on keystrokes.
function composerHasSendableText(useCurrentField=false){
 const draft=typeof getDraft==='function'?getDraft():null;
 const text=useCurrentField?document.getElementById('draft')?.value:undefined;
 const value=text===undefined?draft?.text:text;
 return !!String(value||'').trim()||
  (typeof chatDraftItems==='function'&&chatDraftItems().length>0)||
  (Array.isArray(draft?.files)&&draft.files.length>0);
}
function composerRefresh(){
 const field=root.querySelector('#draft');
 const line=field?.closest('.composeLine');
 if(!line)return;
 const hold=typeof voiceHoldGesture!=='undefined'&&voiceHoldGesture&&!voiceHoldGesture.ended;
 const hasText=composerHasSendableText(true);
 const mic=line.querySelector('.voiceMic'),send=line.querySelector('.composerSend');
 if(mic)mic.hidden=!!hasText&&!hold;
 if(send)send.hidden=!hasText||!!hold;
 // Only alter the input itself; replacing the composer would lose mobile focus.
 field.style.height='40px';
 field.style.height=Math.min(128,Math.max(40,field.scrollHeight))+'px';
 if(typeof voicePaintHold==='function')voicePaintHold();
}
root.addEventListener('input',event=>{
 if(event.target?.id==='draft')composerRefresh();
},true);
root.addEventListener('focusin',event=>{
 if(event.target?.id==='draft')composerRefresh();
},true);
// Enter/Return is always a newline inside the message editor, never "send".
// Capture before the legacy application's key shortcuts and trigger its normal
// input event so the draft state remains in sync.
root.addEventListener('keydown',event=>{
 if(event.target?.id!=='draft'||event.key!=='Enter'||event.isComposing||event.keyCode===229)return;
 event.preventDefault();event.stopImmediatePropagation();
 const field=event.target;
 field.setRangeText('\n',field.selectionStart,field.selectionEnd,'end');
 field.dispatchEvent(new Event('input',{bubbles:true}));
},true);
root.addEventListener('keyup',event=>{
 if(event.target?.id==='draft'&&event.key==='Enter'&&!event.isComposing)
  event.stopImmediatePropagation();
},true);
