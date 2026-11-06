// ART-AE voice messages: browser MediaRecorder, preview, private chunk upload, playback.
// No browser persistence of private audio and no automatic transcription.
let voiceDraft=null;
const voiceAudioCache=new Map(),voiceAudioLoading=new Set();
function voiceParse(text){
 const match=typeof text==='string'&&text.match(/^\[\[voice:v1:([a-f0-9-]{36}):([1-9]\d{0,5}):(webm|mp4):(\d{1,9})\]\]$/i);
 if(!match)return null;
 const id=match[1];
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))return null;
 return {id,parts:Number(match[2]),format:match[3].toLowerCase(),seconds:Number(match[4])};
}
function voiceDuration(seconds){
 seconds=Math.max(0,Math.floor(seconds||0));
 return String(Math.floor(seconds/60))+':'+String(seconds%60).padStart(2,'0');
}
function voiceMicButton(){
 return '<button type="button" class="btn voiceMic" data-act="voiceStart" title="Записать голосовое сообщение" aria-label="Записать голосовое сообщение">🎤</button>';
}
function voicePanel(){
 if(!voiceDraft||voiceDraft.convo!==convo)return '';
 const d=voiceDraft;
 if(d.status==='recording')return '<div class="voiceDraftPanel" role="status"><span class="voiceDot">●</span> Идёт запись… <button type="button" class="btn small" data-act="voiceStop">Остановить</button><button type="button" class="btn small" data-act="voiceCancel">Отмена</button></div>';
 const playable=d.status==='ready'||d.status==='failed';
 const label=d.status==='sending'?'Отправляем голосовое…':d.status==='failed'?'Не удалось отправить. Можно повторить.':'Голосовое · '+voiceDuration(d.seconds);
 return '<div class="voiceDraftPanel"><span>'+label+'</span>'+(playable&&d.preview?'<audio controls preload="metadata" src="'+esc(d.preview)+'" aria-label="Прослушать запись перед отправкой"></audio>':'')+(playable?'<button type="button" class="btn small primary" data-act="voiceSend">Отправить голосовое</button>':'')+'<button type="button" class="btn small" data-act="voiceCancel">Отмена</button></div>';
}
function voiceMessageHtml(message){
 const meta=voiceParse(message.text);
 if(!meta)return linkify(message.text||'');
 const url=voiceAudioCache.get(meta.id);
 return '<div class="voiceMessage"><span>🎙 Голосовое · '+voiceDuration(meta.seconds)+'</span>'+(url?'<audio controls preload="metadata" src="'+esc(url)+'" aria-label="Воспроизвести голосовое сообщение"></audio>':'<button class="btn small" type="button" data-act="voicePlay" data-id="'+meta.id+'" '+(voiceAudioLoading.has(meta.id)?'disabled':'')+'>'+(voiceAudioLoading.has(meta.id)?'Загрузка…':'▶ Слушать')+'</button>')+'</div>';
}
async function voiceStart(){
 if(voiceDraft){alert('Сначала завершите или отмените текущую запись.');return}
 if(!convo)return;
 if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){alert('Этот браузер не поддерживает запись аудио.');return}
 let stream;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  const supported=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  const rec=new MediaRecorder(stream,supported?{mimeType:supported,audioBitsPerSecond:48000}:{audioBitsPerSecond:48000});
  const mime=(rec.mimeType||supported||'').toLowerCase();
  const format=mime.includes('mp4')?'mp4':mime.includes('webm')?'webm':null;
  if(!format)throw Error('Неподдерживаемый формат записи');
  const d={id:crypto.randomUUID(),convo,format,mime,rec,stream,status:'recording',started:Date.now(),pieces:[],preview:null,seconds:0};
  voiceDraft=d;
  rec.ondataavailable=event=>{if(voiceDraft===d&&event.data?.size)d.pieces.push(event.data)};
  rec.onerror=()=>{if(voiceDraft===d){d.status='failed';try{rec.stop()}catch{}render();alert('Ошибка записи с микрофона')}};
  rec.onstop=()=>{
   stream.getTracks().forEach(t=>t.stop());
   if(voiceDraft!==d)return;
   d.seconds=Math.max(1,Math.round((Date.now()-d.started)/1000));
   if(!d.pieces.length){voiceDraft=null;render();alert('Запись пуста');return}
   d.status='ready';
   d.preview=URL.createObjectURL(new Blob(d.pieces,{type:d.mime}));
   render();
  };
  rec.start(15000);
  render();
 }catch(error){
  stream?.getTracks().forEach(t=>t.stop());
  console.warn('Voice recording',error);
  alert('Не удалось начать запись. Проверьте разрешение на микрофон и попробуйте снова.');
 }
}
function voiceStop(){
 const d=voiceDraft;if(!d||d.status!=='recording')return;
 try{d.rec.requestData();d.rec.stop()}catch(e){console.error('Voice stop',e);voiceCancel()}
}
function voiceCancel(){
 const d=voiceDraft;if(!d)return;
 voiceDraft=null;
 if(d.rec?.state==='recording')try{d.rec.stop()}catch{}
 d.stream?.getTracks().forEach(t=>t.stop());
 if(d.preview)URL.revokeObjectURL(d.preview);
 render();
}
async function voiceSend(){
 const d=voiceDraft;if(!d||!['ready','failed'].includes(d.status)||!d.pieces.length)return;
 d.status='sending';render();
 try{
  const blob=new Blob(d.pieces,{type:d.mime}),partSize=1024*1024;
  const count=Math.ceil(blob.size/partSize);
  if(!count||count>999999)throw Error('Слишком большой файл для текущего формата хранения');
  for(let i=0;i<count;i++){
   if(voiceDraft!==d)return;
   const url='/.netlify/functions/voice?'+new URLSearchParams({action:'upload',convo:d.convo,id:d.id,part:String(i),format:d.format});
   const response=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'audio/'+d.format},body:blob.slice(i*partSize,(i+1)*partSize,d.mime)});
   if(!response.ok){let msg='Ошибка загрузки фрагмента '+(i+1);try{msg=(await response.json()).error||msg}catch{}throw Error(msg)}
  }
  if(voiceDraft!==d)return;
  const marker='[[voice:v1:'+d.id+':'+count+':'+d.format+':'+d.seconds+']]';
  const result=await syncApi('send',{convo:d.convo,text:marker,requestId:d.id});
  if(result?.message&&data.messages.every(m=>m.id!==result.message.id))data.messages.push(result.message);
  if(voiceDraft===d){voiceDraft=null;if(d.preview)URL.revokeObjectURL(d.preview);render()}
  if(convo===d.convo)syncMessages(true);
 }catch(error){
  if(voiceDraft===d){
   d.status='failed';render();
   console.warn('Voice upload',error);
   alert('Не удалось отправить голосовое сообщение: '+String(error?.message||error));
  }
 }
}
async function voicePlay(id){
 const message=data.messages.find(m=>m.id===id);
 const meta=voiceParse(message?.text);
 if(!meta||voiceAudioLoading.has(meta.id))return;
 if(voiceAudioCache.has(meta.id)){render();return}
 voiceAudioLoading.add(id);render();
 try{
  const chunks=[];
  for(let i=0;i<meta.parts;i++){
   const url='/.netlify/functions/voice?'+new URLSearchParams({action:'part',convo:message.convo,id:meta.id,part:String(i)});
   const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
   if(!response.ok)throw Error('Фрагмент '+(i+1)+' недоступен');
   chunks.push(await response.blob());
  }
  const objectURL=URL.createObjectURL(new Blob(chunks,{type:'audio/'+meta.format}));
  voiceAudioCache.set(id,objectURL);
  // The initial click should start playback, not merely reveal a second Play button.
  // Render first so the audio element exists, then try playback immediately.
  voiceAudioLoading.delete(id);
  render();
  const player=[...document.querySelectorAll('.voiceMessage audio')].find(audio=>audio.getAttribute('src')===objectURL);
  if(player){
   try{await player.play()}catch(error){
    // Safari can reject play() after asynchronous loading; retain native controls.
    console.info('Voice playback requires user interaction',error?.name||error);
   }
  }
 }catch(error){console.warn('Voice playback',error);alert('Не удалось загрузить голосовое сообщение')}
 finally{
  if(voiceAudioLoading.has(id)){voiceAudioLoading.delete(id);render()}
 }
}
window.addEventListener('pagehide',()=>{
 if(voiceDraft?.preview)URL.revokeObjectURL(voiceDraft.preview);
 for(const url of voiceAudioCache.values())URL.revokeObjectURL(url);
 voiceAudioCache.clear();
});
