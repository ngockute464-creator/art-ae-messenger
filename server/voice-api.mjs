// Authenticated, chunked Yandex Disk storage for ART-AE voice messages.
// No public sharing links and no user-controlled remote URLs.
import {getSession} from './auth.mjs';
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MAX_CHUNK=1280*1024;
const YD='https://cloud-api.yandex.net/v1/disk';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const err=(message,status=400)=>Object.assign(Error(message),{status});
const originOk=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const partIndex=n=>/^(0|[1-9]\d{0,5})$/.test(n||'')?Number(n):null;
function env(){
 const base=process.env.SUPABASE_URL?.replace(/\/+$/,''),key=process.env.SUPABASE_SECRET_KEY,token=process.env.YANDEX_DISK_TOKEN;
 if(!base||!key||!token)throw err('Хранилище не настроено',503);
 const host=new URL(base);
 if(host.protocol!=='https:'||!host.hostname.endsWith('.supabase.co')||host.pathname!=='/')throw err('Некорректная конфигурация хранилища',503);
 return {base,key,token};
}
async function database(table,params){
 const {base,key}=env(),url=new URL(base+'/rest/v1/'+table);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const res=await fetch(url,{headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!res.ok)throw err('Ошибка хранилища',502);
 return res.json();
}
async function conversation(id){
 if(!UUID.test(id||''))throw err('Неверный разговор');
 const rows=await database('artae_conversations',{id:'eq.'+id,deleted_at:'is.null',select:'id,project_id',limit:'1'});
 if(!rows.length)throw err('Разговор не найден',404);
 const project=await database('artae_projects',{id:'eq.'+rows[0].project_id,deleted_at:'is.null',select:'folder_path',limit:'1'});
 const folder=project[0]?.folder_path;
 if(!folder||!/^app:\/[^/]+$/.test(folder)||folder.toLowerCase()==='app:/_system')throw err('Проект недоступен',404);
 return folder;
}
async function disk(method,resource,params={},body){
 const {token}=env(),url=new URL(YD+resource);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const res=await fetch(url,{method,headers:{Authorization:'OAuth '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 if(res.status===409)return {conflict:true};
 if(!res.ok)throw err('Ошибка Яндекс Диска ('+res.status+')',502);
 if(res.status===201||res.status===204)return {};
 return res.json();
}
function transferUrl(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||!(url.hostname==='yandex.ru'||url.hostname.endsWith('.yandex.ru')||url.hostname.endsWith('.yandex.net')||url.hostname.endsWith('.yandex.com')))throw err('Недопустимый адрес передачи',502);
 return url.toString();
}
async function transfer(url,options={}){
 let next=transferUrl(url);
 for(let i=0;i<5;i++){
  const res=await fetch(next,{...options,redirect:'manual',signal:AbortSignal.timeout(30000)});
  if([301,302,303,307,308].includes(res.status)){
   const location=res.headers.get('location');
   if(!location)throw err('Недопустимое перенаправление',502);
   next=transferUrl(new URL(location,next).href);
   continue;
  }
  return res;
 }
 throw err('Слишком много перенаправлений',502);
}
async function readBounded(body){
 const reader=body?.getReader();if(!reader)throw err('Нет аудиоданных');
 let size=0;const parts=[];
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;
   if(size>MAX_CHUNK)throw err('Фрагмент аудио слишком велик',413);
   parts.push(value);
  }
 }finally{reader.releaseLock()}
 if(!size)throw err('Пустая запись');
 const result=new Uint8Array(size);let offset=0;
 for(const part of parts){result.set(part,offset);offset+=part.length}
 return result;
}
export default async function handler(request){
 if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
 if(request.method==='POST'&&!originOk(request))return json({error:'Недопустимый запрос'},403);
 try{
  const session=await getSession(request);
  if(!session)return json({error:'Требуется вход'},401);
  const u=new URL(request.url),action=u.searchParams.get('action'),convo=u.searchParams.get('convo'),id=u.searchParams.get('id'),index=partIndex(u.searchParams.get('part'));
  if(!UUID.test(id||'')||index===null)return json({error:'Недопустимый идентификатор голосового сообщения'},400);
  const root=await conversation(convo);
  const directory=root+'/_artae_voice/'+convo+'/'+id;
  if(request.method==='POST'&&action==='upload'){
   const format=u.searchParams.get('format');
   if(!['webm','mp4'].includes(format))return json({error:'Недопустимый формат аудио'},400);
   if(!/^audio\/(webm|mp4)(?:;.*)?$/i.test(request.headers.get('content-type')||''))return json({error:'Неверный тип данных'},415);
   const bytes=await readBounded(request.body);
   for(const folder of [root+'/_artae_voice',root+'/_artae_voice/'+convo,directory])
    await disk('PUT','/resources',{path:folder});
   const target=directory+'/'+index+'.'+format;
   const link=await disk('GET','/resources/upload',{path:target,overwrite:'true'});
   const response=await transfer(link.href,{method:link.method==='POST'?'POST':'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});
   if(!response.ok)throw err('Не удалось передать аудио',502);
   return json({ok:true,part:index});
  }
  if(request.method==='GET'&&action==='part'){
   // No private audio until a matching chat message has been committed.
   const records=await database('artae_messages',{id:'eq.'+id,conversation_id:'eq.'+convo,deleted_at:'is.null',select:'body',limit:'1'});
   const marker=records[0]?.body?.match(/^\[\[voice:v1:([a-f0-9-]{36}):([1-9]\d{0,5}):(webm|mp4):(\d{1,9})\]\]$/i);
   if(!marker||marker[1].toLowerCase()!==id.toLowerCase()||index>=Number(marker[2]))return json({error:'Голосовое сообщение не найдено'},404);
   const format=marker[3];
   const target=directory+'/'+index+'.'+format;
   const metadata=await disk('GET','/resources',{path:target,fields:'type,size'});
   if(metadata.type!=='file'||!Number.isFinite(metadata.size)||metadata.size>MAX_CHUNK)throw err('Недопустимый фрагмент',413);
   const link=await disk('GET','/resources/download',{path:target});
   const result=await transfer(link.href);
   if(!result.ok)throw err('Не удалось загрузить аудио',502);
   const bytes=await readBounded(result.body);
   return new Response(bytes,{status:200,headers:{'Content-Type':format==='mp4'?'audio/mp4':'audio/webm','Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'}});
  }
  return json({error:'Неизвестная операция'},404);
 }catch(e){
  if(e.status&&e.status!==502)return json({error:e.message},e.status);
  console.error('ARTAE voice',e.message);
  return json({error:'Ошибка передачи голосового сообщения'},502);
 }
}
