// ART-AE voice transcription. Only our authenticated API reaches Cloudflare Workers AI.
// Transcripts and individual segment results live on the private Yandex Disk.
import {getSession} from './auth.mjs';
const YD='https://cloud-api.yandex.net/v1/disk';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MAX_WAV=1280*1024;
const reply=(obj,status=200)=>Response.json(obj,{status,headers:{'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
const fail=(msg,status=400)=>Object.assign(Error(msg),{status});
const originOk=r=>{try{return new URL(r.headers.get('origin')).origin===new URL(r.url).origin}catch{return false}};
function config(){
 const base=process.env.SUPABASE_URL?.replace(/\/+$/,''),key=process.env.SUPABASE_SECRET_KEY,token=process.env.YANDEX_DISK_TOKEN;
 if(!base||!key||!token)throw fail('Хранилище не настроено',503);
 const host=new URL(base);
 if(host.protocol!=='https:'||!host.hostname.endsWith('.supabase.co')||host.pathname!=='/')throw fail('Неверный адрес базы',503);
 return {base,key,token};
}
async function rows(table,params){
 const {base,key}=config(),url=new URL(base+'/rest/v1/'+table);
 for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 const response=await fetch(url,{headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw fail('База данных недоступна',502);
 return response.json();
}
async function voiceLocation(convo,id){
 if(!UUID.test(convo||'')||!UUID.test(id||''))throw fail('Неверное голосовое сообщение');
 const messages=await rows('artae_messages',{id:'eq.'+id,conversation_id:'eq.'+convo,deleted_at:'is.null',select:'id,body',limit:'1'});
 const marker=messages[0]?.body?.match(/^\[\[voice:v1:([a-f0-9-]{36}):([1-9]\d{0,5}):(webm|mp4):(\d{1,9})\]\]$/i);
 if(!marker||marker[1].toLowerCase()!==id.toLowerCase())throw fail('Голосовое сообщение не найдено',404);
 const convos=await rows('artae_conversations',{id:'eq.'+convo,deleted_at:'is.null',select:'project_id',limit:'1'});
 if(!convos.length)throw fail('Разговор не найден',404);
 const projects=await rows('artae_projects',{id:'eq.'+convos[0].project_id,deleted_at:'is.null',select:'folder_path',limit:'1'});
 const folder=projects[0]?.folder_path;
 if(!folder||!/^app:\/[^/]+$/.test(folder)||folder.toLowerCase()==='app:/_system')throw fail('Проект недоступен',404);
 return folder+'/_artae_voice/'+convo+'/'+id;
}
function transferUrl(href){
 const u=new URL(href);
 if(u.protocol!=='https:'||!(u.hostname==='yandex.ru'||u.hostname.endsWith('.yandex.ru')||u.hostname.endsWith('.yandex.net')||u.hostname.endsWith('.yandex.com')))throw fail('Непроверенный адрес Яндекс Диска',502);
 return u.toString();
}
async function transfer(href,opts={}){
 let url=transferUrl(href);
 for(let i=0;i<5;i++){
  const res=await fetch(url,{...opts,redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(res.status)){
   const loc=res.headers.get('location');if(!loc)throw fail('Ошибка передачи файла',502);
   url=transferUrl(new URL(loc,url).href);continue;
  }
  return res;
 }
 throw fail('Слишком много перенаправлений',502);
}
async function disk(method,resource,params={}){
 const {token}=config(),url=new URL(YD+resource);
 for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 const res=await fetch(url,{method,headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(12000)});
 if(res.status===404)return null;
 if(res.status===409)return {conflict:true};
 if(!res.ok)throw fail('Яндекс Диск временно недоступен',502);
 if(res.status===204||res.status===201)return {};
 return res.json();
}
async function getSaved(path){
 const info=await disk('GET','/resources',{path,fields:'type,size'});
 if(!info)return null;
 if(info.type!=='file'||!Number.isFinite(info.size)||info.size>512000)throw fail('Недопустимый результат распознавания',502);
 const link=await disk('GET','/resources/download',{path});
 if(!link?.href)throw fail('Расшифровка временно недоступна',502);
 const res=await transfer(link.href);
 if(!res.ok)throw fail('Ошибка чтения расшифровки',502);
 const body=await res.arrayBuffer();
 if(body.byteLength>512000)throw fail('Расшифровка слишком велика',502);
 let value;try{value=JSON.parse(Buffer.from(body).toString('utf8'))}catch{throw fail('Повреждённый текст расшифровки',502)}
 if(typeof value?.text!=='string'||value.text.length>250000)throw fail('Некорректная расшифровка',502);
 return value;
}
async function putSaved(path,obj){
 const parent=path.slice(0,path.lastIndexOf('/'));
 await disk('PUT','/resources',{path:parent});
 const link=await disk('GET','/resources/upload',{path,overwrite:'false'});
 if(link?.conflict)return getSaved(path);
 if(!link?.href)throw fail('Не удалось сохранить результат',502);
 const payload=Buffer.from(JSON.stringify(obj));
 if(payload.length>512000)throw fail('Текст слишком велик',413);
 const result=await transfer(link.href,{method:link.method==='POST'?'POST':'PUT',body:payload,headers:{'Content-Type':'application/json'}});
 if(result.status===409||result.status===412)return getSaved(path);
 if(!result.ok)throw fail('Не удалось сохранить расшифровку',502);
 return obj;
}
async function readAudio(req){
 // Enforce the byte limit while reading, not after an unbounded arrayBuffer() allocation.
 const expected=Number(req.headers.get('content-length'));
 if(Number.isFinite(expected)&&expected>MAX_WAV)throw fail('Фрагмент аудио слишком велик',413);
 const reader=req.body?.getReader();if(!reader)throw fail('Нет аудиоданных');
 const chunks=[];let total=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>MAX_WAV){await reader.cancel().catch(()=>{});throw fail('Фрагмент аудио слишком велик',413)}
   chunks.push(value);
  }
 }finally{reader.releaseLock()}
 if(total<44)throw fail('Недопустимый WAV',415);
 const data=Buffer.concat(chunks.map(x=>Buffer.from(x)),total);
 if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw fail('Требуется WAV-аудио',415);
 return data;
}
async function cloudflare(wav){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_TOKEN;
 if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw fail('Расшифровка ещё не подключена',503);
 const url='https://api.cloudflare.com/client/v4/accounts/'+account+'/ai/run/@cf/openai/whisper-large-v3-turbo';
 const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({audio:wav.toString('base64'),task:'transcribe'}),signal:AbortSignal.timeout(24000)});
 if(response.status===429)return Promise.reject(fail('Бесплатная квота расшифровки временно исчерпана',429));
 if(!response.ok){console.error('ARTAE Whisper upstream',response.status);throw fail('Cloudflare не смог обработать аудио',502)}
 let payload;try{payload=await response.json()}catch{throw fail('Неверный ответ Whisper',502)}
 const text=payload?.result?.text??payload?.text;
 if(typeof text!=='string'||text.length>12000)throw fail('Неожиданный результат распознавания',502);
 return text.trim();
}
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&!originOk(req))return reply({error:'Недопустимый источник запроса'},403);
 try{
  const session=await getSession(req);
  if(!session)return reply({error:'Требуется вход'},401);
  const url=new URL(req.url),action=url.searchParams.get('action'),
   convo=url.searchParams.get('convo'),id=url.searchParams.get('id');
  const directory=await voiceLocation(convo,id),donePath=directory+'/transcript.json';
  const stored=await getSaved(donePath);
  if(stored)return reply({ok:true,saved:true,text:stored.text});
  if(req.method==='GET'&&action==='status'){
   const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_AI_TOKEN;
   return reply({ok:true,saved:false,text:null,enabled:/^[a-f0-9]{32}$/i.test(account||'')&&!!token});
  }
  if(req.method==='POST'&&action==='chunk'){
   const part=url.searchParams.get('part'),total=url.searchParams.get('total');
   if(!/^(0|[1-9]\d{0,5})$/.test(part||'')||!/^[1-9]\d{0,5}$/.test(total||'')||Number(part)>=Number(total))throw fail('Неверный номер фрагмента');
   if((req.headers.get('content-type')||'').split(';')[0]!=='audio/wav')throw fail('Требуется WAV',415);
   const fragment=directory+'/transcript_parts/'+String(Number(part)).padStart(6,'0')+'.json';
   const cached=await getSaved(fragment);
   if(cached)return reply({ok:true,cached:true,text:cached.text,part:Number(part)});
   // No Cloudflare cost until all authentication and cached-result checks pass.
   const wav=await readAudio(req),text=await cloudflare(wav);
   await putSaved(fragment,{text,part:Number(part),total:Number(total)});
   return reply({ok:true,cached:false,text,part:Number(part)});
  }
  if(req.method==='POST'&&action==='finish'){
   const total=url.searchParams.get('total');
   if(!/^[1-9]\d{0,5}$/.test(total||''))throw fail('Неверное количество фрагментов');
   const text=[];
   for(let i=0;i<Number(total);i++){
    const fragment=directory+'/transcript_parts/'+String(i).padStart(6,'0')+'.json';
    const saved=await getSaved(fragment);
    if(!saved||saved.part!==i||saved.total!==Number(total))return reply({error:'Часть расшифровки ещё не готова',part:i},409);
    text.push(saved.text);
   }
   const full=text.filter(Boolean).join(' ').trim();
   if(full.length>250000)throw fail('Текст слишком велик',413);
   const saved=await putSaved(donePath,{text:full,partCount:Number(total),model:'whisper-large-v3-turbo'});
   return reply({ok:true,saved:true,text:saved.text});
  }
  return reply({error:'Неизвестное действие'},404);
 }catch(e){
  if(e.status&&e.status!==502)return reply({error:e.message},e.status);
  console.error('ARTAE transcript',e.status||'',e.message);
  return reply({error:'Не удалось расшифровать голосовое сообщение'},502);
 }
}
