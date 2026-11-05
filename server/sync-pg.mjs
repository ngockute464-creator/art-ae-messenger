// ART-AE PostgreSQL adapter. Public API remains compatible with current UI.
// Existing accounts and sessions continue to be checked by auth.mjs.
import {randomUUID} from 'node:crypto';
import {getSession} from './auth.mjs';
import {renameProjectFolder,folderForName} from './project-rename.mjs';
const tables={project:'artae_projects',convo:'artae_conversations',message:'artae_messages'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(x,status=200)=>Response.json(x,{status,headers});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const clean=(x,max)=>typeof x==='string'?x.trim().slice(0,max):'';
const time=()=>Date.now();
const avatarOk=x=>x===null||typeof x==='string'&&x.length<=80000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x);
const projectView=r=>({id:r.id,name:r.name,folderPath:r.folder_path,avatar:r.avatar,createdAt:Number(r.created_at),createdBy:r.created_by,updatedAt:r.updated_at===null?null:Number(r.updated_at)});
const convoView=r=>({id:r.id,name:r.name,project:r.project_id,avatar:r.avatar,createdAt:Number(r.created_at),updatedAt:r.updated_at===null?null:Number(r.updated_at)});
const messageView=r=>({id:r.id,convo:r.conversation_id,authorId:r.author_id,who:r.author_name,text:r.body,time:Number(r.created_at),editedAt:r.edited_at===null?null:Number(r.edited_at),deletedAt:r.deleted_at===null?null:Number(r.deleted_at)});
async function db(table,params={},options={}){
 const base=process.env.SUPABASE_URL?.replace(/\/+$/,'');
 const key=process.env.SUPABASE_SECRET_KEY;
 if(!base||!key)throw Object.assign(Error('Supabase not configured'),{status:503});
 const host=new URL(base);
 if(host.protocol!=='https:'||!host.hostname.endsWith('.supabase.co')||host.pathname!=='/')throw Object.assign(Error('Invalid Supabase URL'),{status:503});
 const url=new URL(base+'/rest/v1/'+tables[table]);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const method=options.method||'GET',requestHeaders={apikey:key,Accept:'application/json'};
 if(method!=='GET'){requestHeaders['Content-Type']='application/json';requestHeaders.Prefer='return=representation'}
 const res=await fetch(url,{method,headers:requestHeaders,body:options.body===undefined?undefined:JSON.stringify(options.body),signal:AbortSignal.timeout(12000)});
 if(!res.ok){const raw=await res.text();let error={};try{error=JSON.parse(raw)}catch{}const e=Error(error.message||('Database HTTP '+res.status));e.status=res.status;e.code=error.code;throw e}
 return res.status===204?[]:res.json();
}
async function one(table,id){if(!uuid(id))return null;const rows=await db(table,{id:'eq.'+id,select:'*'});return rows[0]||null}
async function activeProject(id){const p=await one('project',id);return p&&!p.deleted_at?p:null}
async function activeConvo(id){const c=await one('convo',id);return c&&!c.deleted_at&&await activeProject(c.project_id)?c:null}
function originOk(req){try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}}
async function projectFolder(name){
 const token=process.env.YANDEX_DISK_TOKEN;
 if(!token)throw Object.assign(Error('Disk token missing'),{status:503});
 const folder=name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\.+$/,'').trim().slice(0,90)||'Проект';
 if(folder.toLowerCase()==='_system')throw Object.assign(Error('Служебное имя папки запрещено'),{status:400});
 const path='app:/'+folder;
 const res=await fetch('https://cloud-api.yandex.net/v1/disk/resources?'+new URLSearchParams({path}),{method:'PUT',headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(12000)});
 if(!res.ok&&res.status!==409)throw Error('Yandex folder create failed: '+res.status);
 return path;
}
function failed(e){
 if(e.status===503)return reply({error:'Хранилище не настроено'},503);
 if(e.status===400)return reply({error:e.message},400);
 if(e.status===409)return reply({error:e.message},409);
 if(e.code==='23505')return reply({error:'Запись уже существует'},409);
 if(e.code==='23503')return reply({error:'Связанная запись не существует'},409);
 console.error('ARTAE PostgreSQL',e.status,e.code,e.message);
 return reply({error:'Ошибка работы с базой данных. Повторите попытку.'},502);
}
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&(!originOk(req)||!req.headers.get('content-type')?.startsWith('application/json')))return reply({error:'Invalid origin'},403);
 try{
  const session=await getSession(req);if(!session)return reply({error:'Требуется вход'},401);
  let body={};
  if(req.method==='POST'){try{body=await req.json()}catch{return reply({error:'Invalid JSON'},400)}}
  const url=new URL(req.url),action=req.method==='GET'?url.searchParams.get('action'):body.action;
  if(action==='overview'&&req.method==='GET'){
   const [projects,convos]=await Promise.all([db('project',{deleted_at:'is.null',select:'*',order:'created_at.asc'}),db('convo',{deleted_at:'is.null',select:'*',order:'created_at.asc'})]);
   return reply({projects:projects.map(projectView),convos:convos.filter(c=>projects.some(p=>p.id===c.project_id)).map(convoView)});
  }
  if(action==='createProject'&&req.method==='POST'){
   const name=clean(body.name,100);if(!name)return reply({error:'Введите имя проекта'},400);
   const existing=await db('project',{deleted_at:'is.null',select:'id,name'});
   if(existing.some(p=>p.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')))return reply({error:'Проект с таким названием уже существует'},409);
   const path=await projectFolder(name);
   const rows=await db('project',{}, {method:'POST',body:{id:randomUUID(),name,folder_path:path,created_by:session.user.id,created_at:time()}});
   return reply({project:projectView(rows[0])});
  }
  if(action==='updateProject'&&req.method==='POST'){
   const current=await activeProject(body.id);if(!current)return reply({error:'Проект не найден'},404);
   const name=clean(body.name,100);if(!name)return reply({error:'Введите имя проекта'},400);
   if(body.avatar!==undefined&&!avatarOk(body.avatar))return reply({error:'Недопустимый аватар'},400);
   if(name!==current.name){
    const projects=await db('project',{deleted_at:'is.null',select:'id,name,folder_path'});
    const targetPath=folderForName(name);
    if(projects.some(p=>p.id!==current.id&&(p.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')||p.folder_path.toLocaleLowerCase('ru')===targetPath.toLocaleLowerCase('ru'))))return reply({error:'Проект или папка с таким именем уже существует'},409);
   }
   const updated=await renameProjectFolder({oldProject:current,name,db,avatarProvided:body.avatar!==undefined,avatar:body.avatar});
   return reply({project:projectView(updated)});
  }
  if(action==='createConvo'&&req.method==='POST'){
   if(!await activeProject(body.project))return reply({error:'Проект не найден'},404);
   const name=clean(body.name,100);if(!name)return reply({error:'Введите имя беседы'},400);
   const rows=await db('convo',{}, {method:'POST',body:{id:randomUUID(),project_id:body.project,name,created_at:time()}});
   return reply({convo:convoView(rows[0])});
  }
  if(action==='updateConvo'&&req.method==='POST'){
   if(!await activeConvo(body.id))return reply({error:'Беседа не найдена'},404);
   const name=clean(body.name,100);if(!name)return reply({error:'Введите имя беседы'},400);
   const patch={name,updated_at:time()};
   if(body.avatar!==undefined){if(!avatarOk(body.avatar))return reply({error:'Недопустимый аватар'},400);patch.avatar=body.avatar}
   const rows=await db('convo',{id:'eq.'+body.id,deleted_at:'is.null'},{method:'PATCH',body:patch});
   return reply({convo:convoView(rows[0])});
  }
  if(action==='messages'&&req.method==='GET'){
   const id=url.searchParams.get('convo');
   if(!uuid(id))return reply({error:'Invalid conversation'},400);
   if(!await activeConvo(id))return reply({error:'Беседа не найдена'},404);
   const since=Number(url.searchParams.get('since')||0);
   if(!Number.isFinite(since)||since<0)return reply({error:'Invalid cursor'},400);
   const params={conversation_id:'eq.'+id,select:'*',order:'created_at.asc,id.asc',limit:'1000'};
   if(since>0){const cutoff=Math.max(0,Math.floor(since-15000));params.or='(created_at.gte.'+cutoff+',edited_at.gte.'+cutoff+',deleted_at.gte.'+cutoff+')'}
   const messages=await db('message',params);
   return reply({messages:messages.map(messageView),cursor:time(),initial:since===0});
  }
  if(action==='send'&&req.method==='POST'){
   if(!await activeConvo(body.convo))return reply({error:'Беседа не найдена'},404);
   const text=clean(body.text,6000);if(!text)return reply({error:'Введите сообщение'},400);
   const id=uuid(body.requestId)?body.requestId:randomUUID();
   try{const rows=await db('message',{}, {method:'POST',body:{id,conversation_id:body.convo,author_id:session.user.id,author_name:session.user.name,body:text,created_at:time()}});
    return reply({message:messageView(rows[0])});
   }catch(e){if(e.code!=='23505')throw e;const old=await one('message',id);if(old?.author_id!==session.user.id||old.body!==text||old.conversation_id!==body.convo)return reply({error:'Конфликт идентификатора сообщения'},409);return reply({message:messageView(old),repeated:true})}
  }
  if((action==='edit'||action==='delete')&&req.method==='POST'){
   const m=await one('message',body.id);
   if(!m||m.conversation_id!==body.convo||m.deleted_at||!await activeConvo(body.convo))return reply({error:'Сообщение не найдено'},404);
   if(m.author_id!==session.user.id)return reply({error:'Можно изменять только свои сообщения'},403);
   const patch=action==='edit'?{body:clean(body.text,6000),edited_at:time()}:{deleted_at:time()};
   if(action==='edit'&&!patch.body)return reply({error:'Сообщение не может быть пустым'},400);
   const rows=await db('message',{id:'eq.'+body.id,author_id:'eq.'+session.user.id,deleted_at:'is.null'},{method:'PATCH',body:patch});
   if(!rows.length)return reply({error:'Сообщение уже изменено'},409);
   return reply({message:messageView(rows[0])});
  }
  return reply({error:'Unknown action'},404);
 }catch(e){return failed(e)}
}
