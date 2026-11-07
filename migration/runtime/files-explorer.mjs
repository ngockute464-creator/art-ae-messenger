// ART-AE project file explorer API (folders and bounded file transfers).
// Scoped to an existing project folder on Yandex Disk. No auth secrets in browser.
import {getSession} from './auth.mjs';
import {randomUUID} from 'node:crypto';
import {query} from './postgres.mjs';
const YD='https://cloud-api.yandex.net/v1/disk';
const MAX_TRANSFER=3*1024*1024;
async function readLimited(stream,max=MAX_TRANSFER){
 if(!stream)return new Uint8Array();
 const reader=stream.getReader(),chunks=[];let total=0;
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;
   if(total>max){await reader.cancel().catch(()=>{});throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413})}
   chunks.push(value);
  }
 }finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 return bytes;
}
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const response=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const isOrigin=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const forbidden=x=>/[\x00-\x1f\\]/.test(x)||x==='.'||x==='..'||x==='__proto__';
const relative=x=>{
 if(typeof x!=='string'||x.length>500||x.startsWith('/')||x.endsWith('/')||x.includes('//'))throw Object.assign(Error('Некорректный путь'),{status:400});
 if(x==='')return '';
 if(x.split('/').some(part=>['_artae_voice','_artae_edit_staging','!ФайлыИзЧатов'].includes(part)))throw Object.assign(Error('Служебная папка'),{status:403});
 const parts=x.split('/');
 if(parts.length>12||parts.some(p=>!p||p.length>120||forbidden(p)))throw Object.assign(Error('Недопустимый путь'),{status:400});
 return parts.join('/');
};
function folderName(x){
 if(typeof x!=='string')throw Object.assign(Error('Недопустимое имя'),{status:400});
 const s=x.trim();
 if(!s||s.length>100||/[\\/:*?"<>|\x00-\x1f]/.test(s)||s==='.'||s==='..'||(s==='_system'||s==='_artae_voice'||s==='_artae_edit_staging'||s==='!ФайлыИзЧатов')||s.endsWith('.'))throw Object.assign(Error('Недопустимое имя папки'),{status:400});
 return s;
}
function authEnv(){
 const token=process.env.YANDEX_DISK_TOKEN;
 if(!token)throw Object.assign(Error('Яндекс Диск не подключён'),{status:503});
 return {token};
}
async function project(id){
 if(!uuid(id))throw Object.assign(Error('Недопустимый проект'),{status:400});
 const {rows:[p]}=await query(
  'SELECT id,name,folder_path FROM public.artae_projects WHERE id=$1 AND deleted_at IS NULL',
  [id]);
 if(!p)throw Object.assign(Error('Проект не найден'),{status:404});
 if(typeof p.folder_path!=='string'||!/^app:\/[^/]+$/.test(p.folder_path)||p.folder_path.toLowerCase()==='app:/_system')throw Error('Unsafe project folder');
 return p;
}
function apiPath(root,rel){return rel?root+'/'+rel:root}
async function disk(method,path,params={},body){
 const {token}=authEnv(),url=new URL(YD+path);
 for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 const r=await fetch(url,{method,headers:{Authorization:'OAuth '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 if(r.status===404)throw Object.assign(Error('Папка не найдена'),{status:404});
 if(r.status===409)throw Object.assign(Error('Объект уже существует'),{status:409});
 if(!r.ok)throw Object.assign(Error('Ошибка Яндекс Диска ('+r.status+')'),{status:502});
 if(r.status===204||r.status===201&&!r.headers.get('content-length'))return {};
 return r.json();
}
function itemView(i,parent){
 // Resource paths returned by Yandex Disk may use a canonical namespace
 // rather than the app:/ alias used to make the request. Never compare them.
 // Build paths only from the current validated parent and safe direct-child name.
 if(!i||typeof i.name!=='string'||!i.name||(i.name==='_artae_voice'||i.name==='_artae_edit_staging'||i.name==='!ФайлыИзЧатов')||i.name.length>255||
    i.name==='.'||i.name==='..'||/[\\/\x00-\x1f]/.test(i.name)||
    (i.type!=='dir'&&i.type!=='file'))return null;
 const relativePath=parent?parent+'/'+i.name:i.name;
 if(relativePath.length>500)return null;
 return {name:i.name,type:i.type==='dir'?'folder':'file',path:relativePath,size:i.type==='file'?Number(i.size||0):null,modified:i.modified||null,mimeType:i.mime_type||null};
}

function fileName(x){
 if(typeof x!=='string'||x.length>120||x!==x.trim()||!x||(x.toLowerCase()==='_artae_voice'||x.toLowerCase()==='_artae_edit_staging'||x==='!ФайлыИзЧатов')||/[\\/:*?"<>|\x00-\x1f]/.test(x)||x==='.'||x==='..'||x.endsWith('.'))throw Object.assign(Error('Недопустимое имя файла'),{status:400});
 return x;
}
function transferUrl(href){
 let u;try{u=new URL(href)}catch{}
 // Only Yandex Disk infrastructure: never follow private or third-party redirects.
 if(!u||u.protocol!=='https:'||!/(^|\.)(yandex\.(ru|net)|yandexcloud\.net)$/.test(u.hostname)||u.username||u.password||u.port&&u.port!=='443')
  throw Object.assign(Error('Недопустимый адрес передачи файла'),{status:502});
 return u;
}
async function transferFetch(href,options={}){
 let current=transferUrl(href);
 for(let hop=0;hop<6;hop++){
  const r=await fetch(current,{...options,redirect:'manual',signal:options.signal??AbortSignal.timeout(25000)});
  if([301,302,303,307,308].includes(r.status)){
   const location=r.headers.get('location');
   if(!location)throw Object.assign(Error('Ссылка скачивания недействительна'),{status:502});
   current=transferUrl(new URL(location,current).href);
   continue;
  }
  return r;
 }
 throw Object.assign(Error('Слишком много перенаправлений при скачивании'),{status:502});
}
async function download(root,rel){
 if(!rel)throw Object.assign(Error('Выберите файл'),{status:400});
 const path=apiPath(root,rel);
 const meta=await disk('GET','/resources',{path,fields:'name,type,size'});
 if(meta.type!=='file')throw Object.assign(Error('Это не файл'),{status:400});
 if(!Number.isFinite(meta.size)||meta.size<0||meta.size>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 const link=await disk('GET','/resources/download',{path});
 const r=await transferFetch(link.href);
 if(!r.ok)throw Object.assign(Error('Не удалось скачать файл'),{status:502});
 const size=Number(r.headers.get('content-length'));
 if(size>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 const bytes=await readLimited(r.body);
 return new Response(bytes,{status:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(fileName(meta.name)),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
async function upload(root,rel,name,request,overwrite=false){
 const safe=fileName(name);
 const length=Number(request.headers.get('content-length'));
 if(Number.isFinite(length)&&length>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 const bytes=await readLimited(request.body);
 const target=apiPath(root,rel?rel+'/'+safe:safe);
 let link;try{link=await disk('GET','/resources/upload',{path:target,overwrite:overwrite?'true':'false'})}
 catch(error){if(error.status===409)throw Object.assign(Error('Файл с таким именем уже существует'),{status:409});throw error}
 const r=await transferFetch(link.href,{method:link.method==='POST'?'POST':'PUT',body:bytes,headers:{'Content-Type':'application/octet-stream'}});
 if(r.status===409||r.status===412)throw Object.assign(Error('Файл с таким именем уже существует'),{status:409});
 if(!r.ok)throw Object.assign(Error('Не удалось загрузить файл'),{status:502});
 return response({ok:true,path:rel?rel+'/'+safe:safe});
}

async function removeFile(root,rel,projectId){
 if(!rel)throw Object.assign(Error('Выберите файл'),{status:400});
 const path=apiPath(root,rel);
 const meta=await disk('GET','/resources',{path,fields:'name,type'});
 if(meta.type!=='file')throw Object.assign(Error('Удалять можно только файлы'),{status:400});
 const {token}=authEnv();
 const u=new URL(YD+'/resources');
 u.searchParams.set('path',path);
 u.searchParams.set('permanently','false');
 const res=await fetch(u,{method:'DELETE',headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(15000)});
 if(res.status===404)throw Object.assign(Error('Файл уже удалён'),{status:404});
 if(![202,204].includes(res.status))throw Object.assign(Error('Не удалось удалить файл с Яндекс Диска'),{status:502});
 // Pin cleanup follows confirmed deletion; failed cleanup must not retry Disk deletion.
 try{
  await query("DELETE FROM public.artae_pins WHERE project_id=$1 AND item_kind='file' AND item_key=$2",[projectId,rel]);
 }catch(e){console.warn('Pin cleanup deferred:',e.message)}
 return response({ok:true,path:rel});
}
async function list(root,rel){
 const path=apiPath(root,rel);
 let offset=0;const items=[];let total=0;
 for(let i=0;i<20;i++){
  const d=await disk('GET','/resources',{path,limit:'100',offset:String(offset),fields:'_embedded.items.name,_embedded.items.path,_embedded.items.type,_embedded.items.size,_embedded.items.modified,_embedded.items.mime_type,_embedded.total,type,path'});
  if(d.type!=='dir')throw Object.assign(Error('Это не папка'),{status:400});
  const slice=d._embedded?.items||[];
  total=Number(d._embedded?.total||0);
  for(const item of slice){const view=itemView(item,rel);if(view)items.push(view)}
  offset+=slice.length;
  if(offset>=total||slice.length===0)break;
 }
 return {items:items.sort((a,b)=>(a.type===b.type?0:a.type==='folder'?-1:1)||a.name.localeCompare(b.name,'ru')),total,hasMore:offset<total};
}

async function officeLease(action,projectId,rel,token,session){
 const {rows:[r]}=await query(
  'SELECT public.artae_office_lease($1,$2::uuid,$3,$4::uuid,$5::uuid,$6) AS lease',
  [action,projectId,rel,token,session.user.id,session.user.name]);
 if(!r)throw Object.assign(Error('Блокировка редактирования недоступна'),{status:503});
 return r.lease;
}
async function guardOfficeFile(projectId,rel,session){
 if(!/\.(docx|xlsx)$/i.test(rel))return;
 const lock=await officeLease('status',projectId,rel,'00000000-0000-0000-0000-000000000000',session);
 if(lock.busy)throw Object.assign(Error('Документ сейчас редактирует '+(lock.holder||'другой участник')),{status:423});
}
async function requireOfficeLease(projectId,rel,token,session){
 if(!uuid(token))throw Object.assign(Error('Нет действующей блокировки редактирования'),{status:423});
 const r=await officeLease('verify',projectId,rel,token,session);
 if(!r.ok)throw Object.assign(Error('Блокировка истекла. Сохранение отменено, чтобы не перезаписать чужие изменения.'),{status:423});
}


const CHAT_FILES='!ФайлыИзЧатов';
// Validate both the chat membership and the actual committed attachment marker
// before copying. A file UUID by itself is not proof of ownership.
async function requireChatAttachmentMessage(convo,messageId,fileId,name){
 if(!uuid(messageId))throw Object.assign(Error('Недопустимое сообщение'),{status:400});
 const {rows:[m]}=await query('SELECT body FROM public.artae_messages WHERE id=$1 AND conversation_id=$2 AND deleted_at IS NULL',[messageId,convo]);
 if(!m)throw Object.assign(Error('Сообщение не найдено'),{status:404});
 const markers=String(m.body||'').matchAll(/\[\[chatfile:v1:([0-9a-f-]{36}):([^:\]\r\n]{1,360}):(\d{1,15})\]\]/gi);
 for(const mark of markers){
  if(mark[1].toLowerCase()!==fileId.toLowerCase())continue;
  try{if(decodeURIComponent(mark[2])===name)return}catch{}
 }
 throw Object.assign(Error('Вложение не принадлежит сообщению'),{status:403});
}
function chatCopyOperation(href){
 const link=transferUrl(href),match=link.pathname.match(/^\/v1\/disk\/operations\/([a-zA-Z0-9_-]{6,128})$/);
 if(!match)throw Object.assign(Error('Некорректная операция Яндекс Диска'),{status:502});
 return match[1];
}

const chatFileToken=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
async function chatConvoProject(convo,projectId){
 if(!uuid(convo))throw Object.assign(Error('Неверный разговор'),{status:400});
 const {rows:[found]}=await query(
  'SELECT id FROM public.artae_conversations WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL',
  [convo,projectId]);
 if(!found)throw Object.assign(Error('Разговор не принадлежит проекту'),{status:403});
}
async function chatFolder(root){
 const path=root+'/'+CHAT_FILES;
 try{await disk('PUT','/resources',{path})}catch(e){if(e.status!==409)throw e}
 return path;
}
// Browser-safe media types are explicit: never serve arbitrary user content as
// HTML, scripts or an executable type from the application's authenticated origin.
const CHAT_MEDIA_MIMES=Object.freeze({
 png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',
 gif:'image/gif',webp:'image/webp',bmp:'image/bmp',avif:'image/avif',
 heic:'image/heic',heif:'image/heif',
 mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',
 mov:'video/quicktime',ogv:'video/ogg', '3gp':'video/3gpp',
 mkv:'video/x-matroska',avi:'video/x-msvideo'
});
function chatMediaMime(name){
 const ext=name.slice(name.lastIndexOf('.')+1).toLowerCase();
 return CHAT_MEDIA_MIMES[ext]||null;
}
function chatObjectName(id,name){
 if(!chatFileToken(id))throw Object.assign(Error('Недопустимый идентификатор файла'),{status:400});
 return id+'__'+fileName(name);
}

export default async function handler(request){
 if(!['GET','POST','HEAD'].includes(request.method)||
    (request.method==='HEAD'&&new URL(request.url).searchParams.get('action')!=='chatMedia'))
  return response({error:'Method not allowed'},405);
 if(request.method==='POST'&&!isOrigin(request))return response({error:'Недопустимый запрос'},403);
 try{
  const session=await getSession(request);if(!session)return response({error:'Требуется вход'},401);
  const url=new URL(request.url);let args={};
  if(request.method==='POST'&&['upload','officeSave','chatUpload'].includes(url.searchParams.get('action'))&&request.headers.get('content-type')?.split(';')[0]==='application/octet-stream'){
   args={action:url.searchParams.get('action'),project:url.searchParams.get('project'),path:url.searchParams.get('path')||'',name:url.searchParams.get('name'),overwrite:url.searchParams.get('overwrite')==='1',expectedModified:url.searchParams.get('expectedModified'),editToken:url.searchParams.get('editToken'),convo:url.searchParams.get('convo'),fileId:url.searchParams.get('fileId')};
  }else if(request.method==='POST'){
   if(!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'Недопустимый формат запроса'},415);
   try{args=await request.json()}catch{return response({error:'Неправильный JSON'},400)}
  }else args={action:url.searchParams.get('action'),project:url.searchParams.get('project'),path:url.searchParams.get('path')||'',convo:url.searchParams.get('convo'),fileId:url.searchParams.get('fileId'),name:url.searchParams.get('name'),messageId:url.searchParams.get('messageId')};
  // Migration safety: never allow changes to the existing shared Yandex Disk
  // until the operator deliberately enables writes for the next app.
  if(process.env.ARTAE_NEXT_ALLOW_DISK_WRITES!=='1' && [
    'chatUpload','chatUploadLink','officeEditAcquire','officeEditRenew','officeEditRelease',
    'officeSave','officeSaveLink','officeSaveCommit','uploadLink','upload','delete','mkdir','chatCopyToProject'
  ].includes(args.action))return response({error:'Запись на Яндекс Диск для новой системы пока отключена'},503);
  const p=await project(args.project);
  const rel=relative(args.path||'');
  if(['chatUpload','chatUploadLink','chatDownloadLink','chatCopyToProject','chatMedia'].includes(args.action)){
   await chatConvoProject(args.convo,p.id);
   const name=fileName(args.name),object=chatObjectName(args.fileId,name);
   const path=p.folder_path+'/'+CHAT_FILES+'/'+object;
   if(args.action==='chatUpload'&&request.method==='POST'){
    // Small file compatibility path, within Netlify's binary response/request limit.
    await chatFolder(p.folder_path);
    const bytes=await readLimited(request.body);
    const link=await disk('GET','/resources/upload',{path,overwrite:'false'});
    const r=await transferFetch(link.href,{method:link.method==='POST'?'POST':'PUT',body:bytes,headers:{'Content-Type':'application/octet-stream'}});
    if(!r.ok)throw Object.assign(Error('Не удалось сохранить вложение'),{status:502});
    return response({ok:true,fileId:args.fileId,name});
   }
   if(args.action==='chatUploadLink'&&request.method==='POST'){
    await chatFolder(p.folder_path);
    const link=await disk('GET','/resources/upload',{path,overwrite:'false'});
    return response({href:transferUrl(link.href).toString(),method:link.method==='POST'?'POST':'PUT'});
   }
   if(args.action==='chatDownloadLink'&&request.method==='GET'){
    const metadata=await disk('GET','/resources',{path,fields:'type,size,mime_type'});
    if(metadata.type!=='file')throw Object.assign(Error('Вложение не найдено'),{status:404});
    const link=await disk('GET','/resources/download',{path});
    return response({href:transferUrl(link.href).toString(),name,size:metadata.size,mimeType:metadata.mime_type||''});
   }
   if(args.action==='chatMedia'&&['GET','HEAD'].includes(request.method)){
    // The browser loads this same-origin URL with the existing HttpOnly
    // session cookie. The source file is streamed, never buffered or resized.
    await requireChatAttachmentMessage(args.convo,args.messageId,args.fileId,name);
    const mime=chatMediaMime(name);
    if(!mime)throw Object.assign(Error('Формат не поддерживает предпросмотр'),{status:415});
    const source=await disk('GET','/resources',{path,fields:'type,size'});
    if(source.type!=='file')throw Object.assign(Error('Вложение не найдено'),{status:404});
    const fullSize=Number(source.size);
    if(!Number.isSafeInteger(fullSize)||fullSize<0)
     throw Object.assign(Error('Недопустимый размер файла'),{status:502});
    if(request.method==='HEAD'){
     return new Response(null,{status:200,headers:{
      'Content-Type':mime,'Content-Length':String(fullSize),
      'Accept-Ranges':'bytes','Content-Disposition':'inline',
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
     }});
    }
    const rawRange=request.headers.get('range');
    if(rawRange&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(rawRange))
     return new Response(null,{status:416,headers:{
      'Content-Range':'bytes */'+String(source.size||0),
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff'
     }});
    const link=await disk('GET','/resources/download',{path});
    const upstream=await transferFetch(link.href,{
     headers:rawRange?{Range:rawRange}:{},
     signal:request.signal
    });
    if(![200,206].includes(upstream.status)||!upstream.body){
     await upstream.body?.cancel().catch(()=>{});
     throw Object.assign(Error('Не удалось получить медиафайл'),{status:upstream.status===404?404:502});
    }
    const headers=new Headers({
     'Content-Type':mime,
     'Content-Disposition':'inline',
     'Cache-Control':'private, no-store',
     'X-Content-Type-Options':'nosniff',
     'Accept-Ranges':'bytes'
    });
    if(upstream.status===206){
     const range=upstream.headers.get('content-range');
     const bounds=range?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
     if(!bounds||!Number.isSafeInteger(Number(bounds[1]))||
        !Number.isSafeInteger(Number(bounds[2]))||
        Number(bounds[2])<Number(bounds[1])||
        Number(bounds[3])!==fullSize){
      await upstream.body.cancel().catch(()=>{});
      throw Object.assign(Error('Некорректный диапазон медиафайла'),{status:502});
     }
     const partLength=Number(bounds[2])-Number(bounds[1])+1;
     const declared=upstream.headers.get('content-length');
     if(declared!==null&&Number(declared)!==partLength){
      await upstream.body.cancel().catch(()=>{});
      throw Object.assign(Error('Некорректная длина части медиафайла'),{status:502});
     }
     headers.set('Content-Range',range);
     headers.set('Content-Length',String(partLength));
    }else{
     if(upstream.headers.get('accept-ranges')!=='bytes')headers.delete('Accept-Ranges');
     const declared=upstream.headers.get('content-length');
     if(declared!==null&&Number.isSafeInteger(Number(declared))&&Number(declared)>=0)
      headers.set('Content-Length',declared);
    }
    return new Response(upstream.body,{status:upstream.status,headers});
   }
   if(args.action==='chatCopyToProject'&&request.method==='POST'){
    await requireChatAttachmentMessage(args.convo,args.messageId,args.fileId,name);
    const targetName=fileName(args.targetName),targetRel=rel?rel+'/'+targetName:targetName;
    const destination=apiPath(p.folder_path,rel);
    const [source,folder]=await Promise.all([
     disk('GET','/resources',{path,fields:'type,size'}),
     disk('GET','/resources',{path:destination,fields:'type'})
    ]);
    if(source.type!=='file')throw Object.assign(Error('Исходный файл не найден'),{status:404});
    if(folder.type!=='dir')throw Object.assign(Error('Выберите папку проекта'),{status:400});
    // No download, recompression, transcoding or implicit overwrite.
    const copied=await disk('POST','/resources/copy',{
     from:path,path:apiPath(p.folder_path,targetRel),overwrite:'false'
    });
    let operationId=null;
    if(copied?.href){
     let href;try{href=new URL(copied.href)}catch{}
     if(href?.pathname?.includes('/operations/'))operationId=chatCopyOperation(copied.href);
    }
    return response({ok:true,done:!operationId,path:targetRel,
     operationId:operationId||undefined,name:targetName},operationId?202:200);
   }
  }

  if(args.action==='chatCopyStatus'&&request.method==='POST'){
   if(typeof args.operationId!=='string'||!/^[a-zA-Z0-9_-]{6,128}$/.test(args.operationId))
    throw Object.assign(Error('Недопустимая операция'),{status:400});
   const operation=await disk('GET','/operations/'+args.operationId);
   if(operation.status==='failed')throw Object.assign(Error('Копирование не удалось'),{status:502});
   return response({ok:true,done:operation.status==='success'});
  }

  if(['officeEditAcquire','officeEditRenew','officeEditRelease'].includes(args.action)&&request.method==='POST'){
   if(!rel||!/\.(docx|xlsx)$/i.test(rel))throw Object.assign(Error('Редактировать можно только DOCX и XLSX'),{status:400});
   const action=args.action==='officeEditAcquire'?'acquire':args.action==='officeEditRenew'?'renew':'release';
   const leaseToken=action==='acquire'?randomUUID():args.editToken;
   if(!uuid(leaseToken))throw Object.assign(Error('Недопустимый ключ блокировки'),{status:400});
   if(action==='acquire'){
    const meta=await disk('GET','/resources',{path:apiPath(p.folder_path,rel),fields:'type,name'});
    if(meta.type!=='file')throw Object.assign(Error('Документ не найден'),{status:404});
   }
   const lease=await officeLease(action,p.id,rel,leaseToken,session);
   return response({...lease,editToken:lease.ok&&action==='acquire'?leaseToken:undefined},lease.ok?200:423);
  }
  if(args.action==='officeVersion'&&request.method==='GET'){
   if(!rel||!/\.(docx|xlsx)$/i.test(rel))throw Object.assign(Error('Недопустимый документ'),{status:400});
   const info=await disk('GET','/resources',{path:apiPath(p.folder_path,rel),fields:'type,modified,size,name'});
   if(info.type!=='file'||typeof info.modified!=='string'||!info.modified)throw Object.assign(Error('Документ недоступен'),{status:404});
   return response({modified:info.modified,size:info.size});
  }
  if(args.action==='officeSave'&&request.method==='POST'){
   await requireOfficeLease(p.id,rel,args.editToken,session);
   // Save the same document, not an arbitrary new name.
   if(!rel||!/\.(docx|xlsx)$/i.test(rel)||typeof args.expectedModified!=='string'||!args.expectedModified||args.expectedModified.length>100)
    throw Object.assign(Error('Неверная версия документа'),{status:400});
   const full=apiPath(p.folder_path,rel);
   const current=await disk('GET','/resources',{path:full,fields:'type,modified,size,name'});
   if(current.type!=='file')throw Object.assign(Error('Документ не найден'),{status:404});
   if(current.modified!==args.expectedModified)throw Object.assign(Error('Документ изменён другим участником. Обновите документ перед сохранением.'),{status:409});
   const name=rel.split('/').pop(),folder=rel.slice(0,Math.max(0,rel.lastIndexOf('/')));
   // Existing bounded transfer protects Netlify payload and server memory.
   await upload(p.folder_path,folder,name,request,true);
   const updated=await disk('GET','/resources',{path:full,fields:'modified,size'});
   if(typeof updated.modified!=='string')throw Object.assign(Error('Файл записан, но новая версия не подтверждена'),{status:502});
   return response({ok:true,modified:updated.modified,size:updated.size});
  }
  if(args.action==='officeSaveLink'&&request.method==='POST'){
   if(!rel||!/\.(docx|xlsx)$/i.test(rel)||typeof args.expectedModified!=='string'||!args.expectedModified||args.expectedModified.length>100)
    throw Object.assign(Error('Неверная версия документа'),{status:400});
   await requireOfficeLease(p.id,rel,args.editToken,session);
   const current=await disk('GET','/resources',{path:apiPath(p.folder_path,rel),fields:'type,modified'});
   if(current.type!=='file'||current.modified!==args.expectedModified)
    throw Object.assign(Error('Документ изменён. Обновите его перед сохранением.'),{status:409});
   const base=p.folder_path+'/_artae_edit_staging';
   const dir=base+'/'+args.editToken;
   for(const folder of [base,dir]){
    try{await disk('PUT','/resources',{path:folder})}
    catch(e){if(e.status!==409)throw e}
   }
   const stage=dir+'/pending'+(rel.toLowerCase().endsWith('.docx')?'.docx':'.xlsx');
   const link=await disk('GET','/resources/upload',{path:stage,overwrite:'true'});
   return response({href:transferUrl(link.href).toString(),method:link.method==='POST'?'POST':'PUT'});
  }
  if(args.action==='officeSaveCommit'&&request.method==='POST'){
   if(!rel||!/\.(docx|xlsx)$/i.test(rel)||typeof args.expectedModified!=='string'||!args.expectedModified||args.expectedModified.length>100)
    throw Object.assign(Error('Неверная версия документа'),{status:400});
   await requireOfficeLease(p.id,rel,args.editToken,session);
   const final=apiPath(p.folder_path,rel);
   const current=await disk('GET','/resources',{path:final,fields:'type,modified'});
   if(current.type!=='file'||current.modified!==args.expectedModified)
    throw Object.assign(Error('Документ изменён. Обновите его перед сохранением.'),{status:409});
   const stage=p.folder_path+'/_artae_edit_staging/'+args.editToken+'/pending'+(rel.toLowerCase().endsWith('.docx')?'.docx':'.xlsx');
   const staged=await disk('GET','/resources',{path:stage,fields:'type,size'});
   if(staged.type!=='file'||!Number.isFinite(staged.size)||staged.size<1)
    throw Object.assign(Error('Не найден подготовленный документ'),{status:400});
   const operation=await disk('POST','/resources/move',{from:stage,path:final,overwrite:'true'});
   // Yandex may schedule moving large files as an asynchronous operation.
   if(operation?.href){
    const opUrl=transferUrl(operation.href);
    const match=opUrl.pathname.match(/^\/v1\/disk\/operations\/([a-zA-Z0-9_-]+)$/);
    if(!match)throw Object.assign(Error('Некорректная операция Яндекс Диска'),{status:502});
    for(let attempt=0;attempt<12;attempt++){
     // Operation status is a protected Disk API endpoint, not a public transfer URL.
     const status=await disk('GET','/operations/'+match[1]);
     if(status?.status==='success')break;
     if(status?.status==='failed')throw Object.assign(Error('Не удалось заменить документ на Яндекс Диске'),{status:502});
     if(attempt===11)throw Object.assign(Error('Сохранение ещё выполняется. Не закрывайте документ.'),{status:503});
     await new Promise(done=>setTimeout(done,500));
    }
   }
   const updated=await disk('GET','/resources',{path:final,fields:'type,modified,size'});
   if(updated.type!=='file'||typeof updated.modified!=='string'||!updated.modified)
    throw Object.assign(Error('Не удалось подтвердить сохранение'),{status:502});
   return response({ok:true,modified:updated.modified,size:updated.size});
  }
  if(args.action==='uploadLink'&&request.method==='POST'){
   const name=fileName(args.name);
   await guardOfficeFile(p.id,rel?rel+'/'+name:name,session);
   const target=apiPath(p.folder_path,rel?rel+'/'+name:name);
   const link=await disk('GET','/resources/upload',{path:target,overwrite:args.overwrite===true?'true':'false'});
   return response({href:transferUrl(link.href).toString(),method:link.method==='POST'?'POST':'PUT'});
  }
  if(args.action==='downloadLink'&&request.method==='GET'){
   if(!rel)throw Object.assign(Error('Выберите файл'),{status:400});
   const path=apiPath(p.folder_path,rel);
   const meta=await disk('GET','/resources',{path,fields:'type,size'});
   if(meta.type!=='file')throw Object.assign(Error('Это не файл'),{status:400});
   const link=await disk('GET','/resources/download',{path});
   return response({href:transferUrl(link.href).toString(),size:meta.size});
  }
  if(args.action==='list'&&request.method==='GET'){
   const result=await list(p.folder_path,rel);
   return response({project:{id:p.id,name:p.name},path:rel,...result});
  }
  if(args.action==='download'&&request.method==='GET')return await download(p.folder_path,rel);
  if(args.action==='upload'&&request.method==='POST'){await guardOfficeFile(p.id,rel?rel+'/'+fileName(args.name):fileName(args.name),session);return await upload(p.folder_path,rel,args.name,request,args.overwrite===true)}
   if(args.action==='delete'&&request.method==='POST'){await guardOfficeFile(p.id,rel,session);return await removeFile(p.folder_path,rel,p.id)}
  if(args.action==='mkdir'&&request.method==='POST'){
   const name=folderName(args.name);
   try{await disk('PUT','/resources',{path:apiPath(p.folder_path,rel?rel+'/'+name:name)})}
   catch(error){if(error.status===409)throw Object.assign(Error('Папка уже существует'),{status:409});throw error}
   return response({ok:true,path:rel?rel+'/'+name:name});
  }
  return response({error:'Неизвестное действие'},404);
 }catch(e){
  if(e.status&&e.status!==502)return response({error:e.message},e.status);
  console.error('ARTAE explorer',e.message);
  return response({error:'Не удалось выполнить операцию с файлами'},502);
 }
}
