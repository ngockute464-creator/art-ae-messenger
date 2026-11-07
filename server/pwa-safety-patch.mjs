// Expose one conservative safe-reload check to the independent PWA updater.
// Runs in the original application closure; it never exports messages or drafts.
import {readFileSync,writeFileSync} from 'node:fs';
const path='public/app.js';
let app=readFileSync(path,'utf8');
const anchor='function cp(){';
if(app.split(anchor).length!==2)throw Error('PWA: safe reload integration anchor mismatch');
const guard=String.raw`
window.ARTAE_CAN_AUTO_RELOAD=()=>{
 try{
  if(typeof drafts!=='undefined'&&Object.values(drafts||{}).some(d=>
     !!(d&&(String(d.text||'').trim()||(Array.isArray(d.files)&&d.files.length)))))return false;
  if(typeof data!=='undefined'&&Array.isArray(data.messages)&&
     data.messages.some(m=>m.pending||m.sendFailed))return false;
  if(typeof editing!=='undefined'&&editing)return false;
  if(typeof modal!=='undefined'&&modal)return false;
  if(typeof voiceDraft!=='undefined'&&voiceDraft)return false;
  if(typeof chatPendingFiles!=='undefined'&&chatPendingFiles.size)return false;
  if(typeof chatSending!=='undefined'&&chatSending.size)return false;
  if(typeof explorerUploading!=='undefined'&&explorerUploading)return false;
  if(typeof explorerDeleting!=='undefined'&&explorerDeleting)return false;
  if(document.querySelector('.artaeOfficeOverlay,.artaeOfficeWarmActive,.messageEdit'))return false;
  const active=document.activeElement;
  if(active?.matches?.('textarea,input,[contenteditable="true"]')&&
     String(active.value??active.textContent??'').trim())return false;
  return true;
 }catch(error){
  console.warn('ART-AE PWA: update safety check failed',error);
  return false;
 }
};
`;
app=app.replace(anchor,guard+'\n'+anchor);
writeFileSync(path,app);
console.log('ART-AE: protected drafts, messages and Office sessions during auto-update');
