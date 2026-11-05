// ART-AE project file explorer API (folders and bounded file transfers).
// Scoped to an existing project folder on Yandex Disk. No auth secrets in browser.
import {getSession} from './auth.mjs';
const YD='https://cloud-api.yandex.net/v1/disk';
const MAX_TRANSFER=3*1024*1024;
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const response=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const isOrigin=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const forbidden=x=>/[\x00-\x1f\\]/.test(x)||x==='.'||x==='..'||x==='__proto__';
const relative=x=>{
 if(typeof x!=='string'||x.length>500||x.startsWith('/')||x.endsWith('/')||x.includes('//'))throw Object.assign(Error('Некорректный путь'),{status:400});
 if(x==='')return '';
 const parts=x.split('/');
 if(parts.length>12||parts.some(p=>!p||p.length>120||forbidden(p)))throw Object.assign(Error('Недопустимый путь'),{status:400});
 return parts.join('/');
};
function folderName(x){
 if(typeof x!=='string')throw Object.assign(Error('Недопустимое имя'),{status:400});
 const s=x.trim();
 if(!s||s.length>100||/[\\/:*?"<>|\x00-\x1f]/.test(s)||s==='.'||s==='..'||s==='_system'||s.endsWith('.'))throw Object.assign(Error('Недопустимое имя папки'),{status:400});
 return s;
}
function authEnv(){
 const base=process.env.SUPABASE_URL?.replace(/\/+$/,''),key=process.env.SUPABASE_SECRET_KEY,token=process.env.YANDEX_DISK_TOKEN;
 if(!base||!key||!token)throw Object.assign(Error('Хранилище не настроено'),{status:503});
 const url=new URL(base);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.pathname!=='/')throw Object.assign(Error('Invalid database host'),{status:503});
 return {base,key,token};
}
async function project(id){
 if(!uuid(id))throw Object.assign(Error('Недопустимый проект'),{status:400});
 const {base,key}=authEnv(),url=new URL(base+'/rest/v1/artae_projects');
 url.search=new URLSearchParams({id:'eq.'+id,deleted_at:'is.null',select:'id,name,folder_path',limit:'1'}).toString();
 const r=await fetch(url,{headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Project database unavailable');
 const rows=await r.json(),p=rows[0];if(!p)throw Object.assign(Error('Проект не найден'),{status:404});
 if(typeof p.folder_path!=='string'||!/^app:\/[^/]+$/.test(p.folder_path)||p.folder_path.toLowerCase()==='app:/_system')throw Error('Unsafe project folder');
 return p;
}
function apiPath(root,rel){return rel?root+'/'+rel:root}
async function disk(method,path,params={},body){
 const {token}=authEnv(),url=new URL(YD+path);
 for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 const r=await fetch(url,{method,headers:{Authorization:'OAuth '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 if(r.status===404)throw Object.assign(Error('Папка не найдена'),{status:404});
 if(r.status===409)throw Object.assign(Error('Папка уже существует'),{status:409});
 if(!r.ok)throw Object.assign(Error('Ошибка Яндекс Диска ('+r.status+')'),{status:502});
 if(r.status===204||r.status===201&&!r.headers.get('content-length'))return {};
 return r.json();
}
function itemView(i,parent){
 // Resource paths returned by Yandex Disk may use a canonical namespace
 // rather than the app:/ alias used to make the request. Never compare them.
 // Build paths only from the current validated parent and safe direct-child name.
 if(!i||typeof i.name!=='string'||!i.name||i.name.length>255||
    i.name==='.'||i.name==='..'||/[\\/\x00-\x1f]/.test(i.name)||
    (i.type!=='dir'&&i.type!=='file'))return null;
 const relativePath=parent?parent+'/'+i.name:i.name;
 if(relativePath.length>500)return null;
 return {name:i.name,type:i.type==='dir'?'folder':'file',path:relativePath,size:i.type==='file'?Number(i.size||0):null,modified:i.modified||null,mimeType:i.mime_type||null};
}

function fileName(x){
 if(typeof x!=='string'||x.length>120||x!==x.trim()||!x||/[\\/:*?"<>|\x00-\x1f]/.test(x)||x==='.'||x==='..'||x.endsWith('.'))throw Object.assign(Error('Недопустимое имя файла'),{status:400});
 return x;
}
function transferUrl(href){
 let u;try{u=new URL(href)}catch{}
 if(!u||u.protocol!=='https:'||!/(^|\.)yandex\.(ru|net)$/.test(u.hostname)||u.username||u.password)throw Object.assign(Error('Недопустимый адрес передачи файла'),{status:502});
 return u;
}
async function download(root,rel){
 if(!rel)throw Object.assign(Error('Выберите файл'),{status:400});
 const path=apiPath(root,rel);
 const meta=await disk('GET','/resources',{path,fields:'name,type,size'});
 if(meta.type!=='file')throw Object.assign(Error('Это не файл'),{status:400});
 if(!Number.isFinite(meta.size)||meta.size<0||meta.size>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 const link=await disk('GET','/resources/download',{path});
 const r=await fetch(transferUrl(link.href),{signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!r.ok)throw Object.assign(Error('Не удалось скачать файл'),{status:502});
 const size=Number(r.headers.get('content-length'));
 if(size>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 const bytes=await r.arrayBuffer();
 if(bytes.byteLength>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 return new Response(bytes,{status:200,headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(fileName(meta.name)),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
async function upload(root,rel,name,request){
 const safe=fileName(name);
 const length=Number(request.headers.get('content-length'));
 if(Number.isFinite(length)&&length>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 const bytes=await request.arrayBuffer();
 if(bytes.byteLength>MAX_TRANSFER)throw Object.assign(Error('Файл превышает лимит 3 МБ'),{status:413});
 const target=apiPath(root,rel?rel+'/'+safe:safe);
 const link=await disk('GET','/resources/upload',{path:target,overwrite:'false'});
 const r=await fetch(transferUrl(link.href),{method:link.method==='POST'?'POST':'PUT',body:bytes,headers:{'Content-Type':'application/octet-stream'},signal:AbortSignal.timeout(25000),redirect:'error'});
 if(r.status===409||r.status===412)throw Object.assign(Error('Файл с таким именем уже существует'),{status:409});
 if(!r.ok)throw Object.assign(Error('Не удалось загрузить файл'),{status:502});
 return response({ok:true,path:rel?rel+'/'+safe:safe});
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
export default async function handler(request){
 if(!['GET','POST'].includes(request.method))return response({error:'Method not allowed'},405);
 if(request.method==='POST'&&!isOrigin(request))return response({error:'Недопустимый запрос'},403);
 try{
  const session=await getSession(request);if(!session)return response({error:'Требуется вход'},401);
  const url=new URL(request.url);let args={};
  if(request.method==='POST'&&url.searchParams.get('action')==='upload'&&request.headers.get('content-type')?.split(';')[0]==='application/octet-stream'){
   args={action:'upload',project:url.searchParams.get('project'),path:url.searchParams.get('path')||'',name:url.searchParams.get('name')};
  }else if(request.method==='POST'){
   if(!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'Недопустимый формат запроса'},415);
   try{args=await request.json()}catch{return response({error:'Неправильный JSON'},400)}
  }else args={action:url.searchParams.get('action'),project:url.searchParams.get('project'),path:url.searchParams.get('path')||''};
  const p=await project(args.project);
  const rel=relative(args.path||'');
  if(args.action==='list'&&request.method==='GET'){
   const result=await list(p.folder_path,rel);
   return response({project:{id:p.id,name:p.name},path:rel,...result});
  }
  if(args.action==='download'&&request.method==='GET')return await download(p.folder_path,rel);
  if(args.action==='upload'&&request.method==='POST')return await upload(p.folder_path,rel,args.name,request);
  if(args.action==='mkdir'&&request.method==='POST'){
   const name=folderName(args.name);
   await disk('PUT','/resources',{path:apiPath(p.folder_path,rel?rel+'/'+name:name)});
   return response({ok:true,path:rel?rel+'/'+name:name});
  }
  return response({error:'Неизвестное действие'},404);
 }catch(e){
  if(e.status&&e.status!==502)return response({error:e.message},e.status);
  console.error('ARTAE explorer',e.message);
  return response({error:'Не удалось выполнить операцию с файлами'},502);
 }
}
