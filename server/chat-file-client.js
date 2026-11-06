// Persistent chat files in !ФайлыИзЧатов, not the visible project explorer.
const chatPendingFiles=new Map(),chatSending=new Set();
const chatFilePattern=/\[\[chatfile:v1:([0-9a-f-]{36}):([^:\]\r\n]{1,360}):(\d{1,15})\]\]/gi;
function chatDraftItems(cid=convo){return chatPendingFiles.get(cid)||[]}
function chatFileDraftHtml(){
 return chatDraftItems().map((entry,index)=>'<span class="draftFile"><span class="draftFileName">📎 '+esc(entry.file.name)+'</span><span class="draftFileSize">'+(entry.file.size/1048576).toFixed(2)+' МБ</span><button type="button" class="draftRemove" data-chat-remove="'+index+'" aria-label="Убрать '+esc(entry.file.name)+'" '+(chatSending.has(convo)?'disabled':'')+'>×</button></span>').join('');
}
function chatFilePick(){
 if(!convo||!project||chatSending.has(convo))return;
 const cid=convo,input=document.createElement('input');input.type='file';input.multiple=true;input.hidden=true;document.body.append(input);
 input.addEventListener('change',()=>{
  const chosen=[...input.files];input.remove();if(!chosen.length)return;
  const current=chatDraftItems(cid);
  if(current.length+chosen.length>10){alert('Не более 10 вложений в одном сообщении');return}
  chatPendingFiles.set(cid,current.concat(chosen.map(file=>({id:crypto.randomUUID(),file,uploaded:false}))));
  if(convo===cid)render();
 },{once:true});
 input.click();
 window.addEventListener('focus',()=>setTimeout(()=>{if(input.isConnected)input.remove()},1500),{once:true});
}
function chatFileMessageHtml(m){
 const body=m.text||'',attachments=[];chatFilePattern.lastIndex=0;
 const caption=body.replace(chatFilePattern,(original,id,encoded,size)=>{
  let name;try{name=decodeURIComponent(encoded)}catch{return original}
  if(!name||name.length>120||/[\\/\x00-\x1f]/.test(name))return original;
  attachments.push({id,name,size:Number(size)});return '';
 });
 if(!attachments.length)return voiceMessageHtml(m);
 const buttons=attachments.map(f=>'<button class="chatStoredFile" type="button" data-chat-download="'+f.id+'" data-chat-name="'+esc(f.name)+'" data-chat-convo="'+m.convo+'" aria-label="Открыть '+esc(f.name)+'">📎 <span class="chatStoredFileName">'+esc(f.name)+'</span><span class="chatStoredFileSize">'+(f.size/1048576).toFixed(2)+' МБ</span></button>').join('');
 return (caption.trim()?'<div class="chatFileCaption">'+linkify(caption.trim())+'</div>':'')+'<div class="chatStoredFiles">'+buttons+'</div>';
}
async function chatApi(action,params,binary){
 const endpoint='/.netlify/functions/files-explorer',options={credentials:'same-origin',cache:'no-store'};let url=endpoint;
 if(binary){
  url+='?'+new URLSearchParams({action,...params});options.method='POST';options.headers={'Content-Type':'application/octet-stream'};options.body=binary;
 }else if(action==='chatDownloadLink')url+='?'+new URLSearchParams({action,...params});
 else{options.method='POST';options.headers={'Content-Type':'application/json'};options.body=JSON.stringify({action,...params})}
 const response=await fetch(url,options);let result={};try{result=await response.json()}catch{}
 if(!response.ok)throw Error(result.error||'Ошибка передачи файла (HTTP '+response.status+')');
 return result;
}
async function chatUploadEntry(entry,context){
 if(entry.uploaded)return;
 const params={project:context.project,convo:context.convo,fileId:entry.id,name:entry.file.name};
 if(entry.file.size<=3*1024*1024)await chatApi('chatUpload',params,entry.file);
 else{
  const link=await chatApi('chatUploadLink',params),url=new URL(link.href);
  if(url.protocol!=='https:'||!/(^|\.)(yandex\.(ru|net)|yandexcloud\.net)$/.test(url.hostname))throw Error('Недопустимая ссылка Яндекс Диска');
  let res;try{res=await fetch(url.href,{method:link.method==='POST'?'POST':'PUT',body:entry.file,credentials:'omit'})}
  catch{throw Error('Браузер заблокировал прямую загрузку большого файла (CORS)')}
  if(!res.ok)throw Error('Яндекс Диск отклонил загрузку (HTTP '+res.status+')');
 }
 entry.uploaded=true;
}
async function chatFileSend(event){
 const cid=convo,items=chatDraftItems(cid);
 if(!cid||!items.length)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(chatSending.has(cid))return;
 const pid=project,caption=($('draft')?.value||'').trim(),button=event.target.querySelector('button[type=submit]');
 chatSending.add(cid);if(button)button.disabled=true;
 try{
  for(let i=0;i<items.length;i++){
   if(button?.isConnected)button.title='Загрузка '+(i+1)+' из '+items.length;
   await chatUploadEntry(items[i],{project:pid,convo:cid});
  }
  const markers=items.map(item=>'[[chatfile:v1:'+item.id+':'+encodeURIComponent(item.file.name)+':'+item.file.size+']]').join('\n');
  const text=markers+(caption?'\n'+caption:'');
  if(text.length>6000)throw Error('Слишком много вложений или слишком длинное сообщение');
  const result=await syncApi('send',{convo:cid,text,requestId:crypto.randomUUID()});
  if(!result?.message?.id)throw Error('Не удалось подтвердить сообщение');
  chatPendingFiles.delete(cid);const draft=drafts[cid];if(draft){draft.text='';draft.files=[]}
  if(!data.messages.some(m=>m.id===result.message.id))data.messages.push(result.message);
  if(convo===cid){render();syncMessages(true)}
 }catch(error){alert('Ошибка вложения: '+String(error?.message||error))}
 finally{chatSending.delete(cid);if(button?.isConnected){button.disabled=false;button.removeAttribute('title')}}
}
async function chatFileOpen(button){
 const fileId=button.dataset.chatDownload,name=button.dataset.chatName,cid=button.dataset.chatConvo;
 if(!fileId||!name||!cid||!project)return;
 try{
  const link=await chatApi('chatDownloadLink',{project,convo:cid,fileId,name});
  const a=document.createElement('a');a.href=link.href;a.target='_blank';a.rel='noopener noreferrer';
  document.body.append(a);a.click();a.remove();
 }catch(error){alert('Не удалось открыть файл: '+String(error?.message||error))}
}
root.addEventListener('submit',event=>{
 if(event.target?.id==='compose'&&chatDraftItems().length)void chatFileSend(event);
},true);
root.addEventListener('click',event=>{
 const remove=event.target.closest('[data-chat-remove]');
 if(remove){
  event.preventDefault();event.stopImmediatePropagation();
  if(chatSending.has(convo))return;
  const items=chatDraftItems();items.splice(Number(remove.dataset.chatRemove),1);
  if(!items.length)chatPendingFiles.delete(convo);render();return;
 }
 const open=event.target.closest('[data-chat-download]');
 if(open){event.preventDefault();event.stopImmediatePropagation();void chatFileOpen(open)}
},true);
