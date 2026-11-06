// ART-AE Cloudflare transcription: client decodes original audio and sends
// independently decodable PCM/WAV segments, never arbitrary WebM byte slices.
const voiceTranscriptCache=new Map(),voiceTranscriptBusy=new Map(),voiceTranscriptErrors=new Map();
function voiceTranscriptControls(m){
 const meta=voiceParse(m.text);
 if(!meta)return '';
 const text=voiceTranscriptCache.get(meta.id);
 if(text!==undefined)return '<div class="voiceTranscriptText">'+(text?esc(text):'Речь не распознана')+'</div>'+(text?'<button class="btn small voiceTranscriptCopy" type="button" data-act="voiceTranscriptCopy" data-id="'+meta.id+'">Скопировать текст</button>':'');
 const state=voiceTranscriptBusy.get(meta.id);
 const label=state||'Расшифровать';
 const error=voiceTranscriptErrors.get(meta.id);
 return '<div class="voiceTranscriptActions"><button type="button" class="btn small" data-act="voiceTranscribe" data-id="'+meta.id+'" '+(state?'disabled':'')+'>'+label+'</button>'+(error?'<span class="voiceTranscriptError">'+esc(error)+'</span>':'')+'</div>';
}
function voiceTranscriptUrl(action,m,extra={}){
 return '/.netlify/functions/voice-transcript?'+new URLSearchParams({action,convo:m.convo,id:m.id,...extra});
}
async function voiceReadTranscriptStatus(m){
 const response=await fetch(voiceTranscriptUrl('status',m),{credentials:'same-origin',cache:'no-store'});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Не удалось получить расшифровку');
 if(result.saved&&typeof result.text==='string'){
  voiceTranscriptCache.set(m.id,result.text);
  return true;
 }
 if(result.enabled===false)throw Error('Расшифровка ещё не подключена: нужны ключи Cloudflare в Netlify');
 return false;
}
async function voiceDownloadForTranscription(m,meta){
 // A previous Listen may have downloaded and cached a secure browser Blob URL.
 const cached=voiceAudioCache.get(meta.id);
 if(cached){
  const response=await fetch(cached);
  if(response.ok)return response.blob();
 }
 const blobs=[];
 for(let i=0;i<meta.parts;i++){
  const response=await fetch('/.netlify/functions/voice?'+new URLSearchParams({action:'part',convo:m.convo,id:meta.id,part:String(i)}),{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('Не удалось загрузить аудио ('+(i+1)+' из '+meta.parts+')');
  blobs.push(await response.blob());
 }
 return new Blob(blobs,{type:'audio/'+meta.format});
}
function voiceWavSegment(buffer,startFrame,frameCount){
 // Mono 16 kHz, signed PCM16, independent WAV headers for every 20-second segment.
 const targetRate=16000,bytes=new ArrayBuffer(44+Math.ceil(frameCount*targetRate/buffer.sampleRate)*2);
 const view=new DataView(bytes),outCount=(bytes.byteLength-44)/2;
 function str(pos,s){for(let i=0;i<s.length;i++)view.setUint8(pos+i,s.charCodeAt(i))}
 str(0,'RIFF');view.setUint32(4,36+outCount*2,true);str(8,'WAVE');str(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,targetRate,true);view.setUint32(28,targetRate*2,true);
 view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,outCount*2,true);
 const channels=Math.min(buffer.numberOfChannels,2);
 const data=Array.from({length:channels},(_,i)=>buffer.getChannelData(i));
 for(let i=0;i<outCount;i++){
  const position=Math.min(buffer.length-1,startFrame+i*buffer.sampleRate/targetRate);
  const at=Math.floor(position),next=Math.min(buffer.length-1,at+1),mix=position-at;
  let value=0;for(const channel of data)value+=channel[at]*(1-mix)+channel[next]*mix;
  value=Math.max(-1,Math.min(1,value/channels));
  view.setInt16(44+i*2,value<0?Math.round(value*32768):Math.round(value*32767),true);
 }
 return new Blob([bytes],{type:'audio/wav'});
}
async function voiceTranscribe(id){
 const m=data.messages.find(x=>x.id===id),meta=voiceParse(m?.text);
 if(!m||!meta||voiceTranscriptBusy.has(id))return;
 voiceTranscriptBusy.set(id,'Проверяем…');voiceTranscriptErrors.delete(id);render();
 try{
  if(await voiceReadTranscriptStatus(m))return;
  if(!window.AudioContext&&!window.webkitAudioContext)throw Error('Браузер не поддерживает обработку аудио');
  voiceTranscriptBusy.set(id,'Подготавливаем аудио…');render();
  const original=await voiceDownloadForTranscription(m,meta);
  const encoded=await original.arrayBuffer();
  const AudioConstructor=window.AudioContext||window.webkitAudioContext;
  const audioContext=new AudioConstructor();
  let buffer;
  try{buffer=await audioContext.decodeAudioData(encoded.slice(0))}
  finally{await audioContext.close().catch(()=>{})}
  if(!buffer?.length||!buffer.sampleRate)throw Error('Аудиофайл не удалось прочитать');
  const secondsPerChunk=20,framesPerChunk=secondsPerChunk*buffer.sampleRate;
  const total=Math.ceil(buffer.length/framesPerChunk);
  for(let part=0;part<total;part++){
   voiceTranscriptBusy.set(id,'Расшифровка '+(part+1)+' / '+total);render();
   const start=part*framesPerChunk,frames=Math.min(framesPerChunk,buffer.length-start);
   const wav=voiceWavSegment(buffer,start,frames);
   const response=await fetch(voiceTranscriptUrl('chunk',m,{part:String(part),total:String(total)}),{
    method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'audio/wav'},body:wav});
   let result={};try{result=await response.json()}catch{}
   if(!response.ok)throw Error(result.error||'Ошибка Whisper, фрагмент '+(part+1));
  }
  voiceTranscriptBusy.set(id,'Сохраняем текст…');render();
  const response=await fetch(voiceTranscriptUrl('finish',m,{total:String(total)}),{
   method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
  let result={};try{result=await response.json()}catch{}
  if(!response.ok||typeof result.text!=='string')throw Error(result.error||'Не удалось сохранить расшифровку');
  voiceTranscriptCache.set(id,result.text);
 }catch(error){
  console.warn('ARTAE transcript',error);
  voiceTranscriptErrors.set(id,String(error?.message||error).slice(0,180));
 }finally{voiceTranscriptBusy.delete(id);render()}
}
async function voiceTranscriptCopy(id){
 const text=voiceTranscriptCache.get(id);
 if(!text)return;
 try{await navigator.clipboard.writeText(text)}
 catch{alert('Не удалось скопировать текст. Выделите его вручную.')}
}
