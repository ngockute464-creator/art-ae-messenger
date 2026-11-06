// Shared project and conversation pins; no browser-local pins.
import {randomUUID} from 'node:crypto';
import {getSession} from './auth.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(x,status=200)=>Response.json(x,{status,headers});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const failure=(message,status=400)=>Object.assign(Error(message),{status});
const sameOrigin=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
async function db(table,params={},method='GET',body){
 const root=process.env.SUPABASE_URL?.replace(/\/+$/,''),key=process.env.SUPABASE_SECRET_KEY;
 if(!root||!key)throw failure('База данных не настроена',503);
 const host=new URL(root);
 if(host.protocol!=='https:'||!host.hostname.endsWith('.supabase.co')||host.pathname!=='/')throw failure('Неверный адрес базы',503);
 const u=new URL(root+'/rest/v1/'+table);
 for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
 const h={apikey:key,Accept:'application/json'};
 if(method!=='GET'){h['Content-Type']='application/json';h.Prefer='return=representation'}
 const r=await fetch(u,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(!r.ok){const raw=await r.text();let e={};try{e=JSON.parse(raw)}catch{}
  if(e.code==='42P01'||e.code==='PGRST205')throw failure('Таблица закреплений пока не создана в Supabase',503);
  const err=failure(e.message||'Ошибка PostgreSQL',r.status);err.code=e.code;err.internalDb=true;throw err}
 return r.status===204?[]:r.json();
}
async function activeProject(id){
 if(!uuid(id))throw failure('Недопустимый проект');
 const p=await db('artae_projects',{id:'eq.'+id,deleted_at:'is.null',select:'id',limit:'1'});
 if(!p.length)throw failure('Проект не найден',404);return id;
}
async function validateScope(project,scope,scopeId){
 await activeProject(project);
 if(!['project','convo'].includes(scope)||!uuid(scopeId))throw failure('Недопустимая область');
 if(scope==='project'&&scopeId!==project)throw failure('Несовпадение проекта');
 if(scope==='convo'){
  const c=await db('artae_conversations',{id:'eq.'+scopeId,project_id:'eq.'+project,deleted_at:'is.null',select:'id',limit:'1'});
  if(!c.length)throw failure('Разговор не найден',404);
 }
}
function validItem(kind,item){
 if(kind==='message')return uuid(item);
 if(kind!=='file'||typeof item!=='string'||!item||item.length>500||item.startsWith('/')||item.endsWith('/')||item.includes('//'))return false;
 const parts=item.split('/');
 return parts.length<=12&&parts.every(x=>x.length<=120&&x!=='.'&&x!=='..'&&!/[\\\x00-\x1f]/.test(x));
}
const mapPin=p=>({id:p.id,kind:p.item_kind,item:p.item_key,scope:p.scope,scopeId:p.scope_id,project:p.project_id,note:p.note||'',createdAt:Number(p.created_at),previewText:''});
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&(!sameOrigin(req)||!req.headers.get('content-type')?.startsWith('application/json')))return reply({error:'Недопустимый запрос'},403);
 try{
  if(!await getSession(req))return reply({error:'Требуется вход'},401);
  const url=new URL(req.url);
  let arg={};if(req.method==='POST'){try{arg=await req.json()}catch{return reply({error:'Неправильный JSON'},400)}}
  if(req.method==='GET'){
   const project=url.searchParams.get('project');await activeProject(project);
   const pins=await db('artae_pins',{project_id:'eq.'+project,select:'*',order:'created_at.desc',limit:'500'});
   const msgIds=[...new Set(pins.filter(p=>p.item_kind==='message'&&uuid(p.item_key)).map(p=>p.item_key))];
   let byId=new Map();
   for(let i=0;i<msgIds.length;i+=80){
    const rows=await db('artae_messages',{id:'in.('+msgIds.slice(i,i+80).join(',')+')',deleted_at:'is.null',select:'id,body,conversation_id',limit:'80'});
    for(const m of rows)byId.set(m.id,m);
   }
   const alive=pins.filter(p=>p.item_kind!=='message'||byId.has(p.item_key));
   return reply({pins:alive.map(p=>({...mapPin(p),previewText:p.item_kind==='message'?byId.get(p.item_key).body:p.item_key,convoId:byId.get(p.item_key)?.conversation_id||null}))});
  }
  const {action,project,scope,scopeId,kind,item}=arg;
  if(action==='remove'){
   if(!uuid(arg.id))return reply({error:'Неверное закрепление'},400);
   const rows=await db('artae_pins',{id:'eq.'+arg.id,select:'*'});
   if(!rows.length)return reply({ok:true});
   await activeProject(rows[0].project_id);
   await db('artae_pins',{id:'eq.'+arg.id},'DELETE');
   return reply({ok:true});
  }
  if(action==='verifyMissing'){
   if(!uuid(arg.id))return reply({error:'Неверное закрепление'},400);
   const rows=await db('artae_pins',{id:'eq.'+arg.id,item_kind:'eq.file',select:'*',limit:'1'});
   if(!rows.length)return reply({ok:true,removed:false});
   const pin=rows[0];await activeProject(pin.project_id);
   if(!validItem('file',pin.item_key))return reply({error:'Недопустимый файл'},400);
   const projectRows=await db('artae_projects',{id:'eq.'+pin.project_id,select:'folder_path',limit:'1'});
   const folder=projectRows[0]?.folder_path;
   if(!folder||!/^app:\/[^/]+$/.test(folder))return reply({error:'Недопустимая папка проекта'},400);
   const token=process.env.YANDEX_DISK_TOKEN;
   if(!token)return reply({error:'Яндекс Диск не настроен'},503);
   const check=new URL('https://cloud-api.yandex.net/v1/disk/resources');
   check.searchParams.set('path',folder+'/'+pin.item_key);check.searchParams.set('fields','name,type');
   const found=await fetch(check,{headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(15000)});
   if(found.status!==404)return reply({ok:true,removed:false});
   await db('artae_pins',{id:'eq.'+pin.id},'DELETE');return reply({ok:true,removed:true});
  }
  if(action==='note'){
   if(!uuid(arg.id)||typeof arg.note!=='string'||arg.note.length>300)return reply({error:'Недопустимое примечание'},400);
   const rows=await db('artae_pins',{id:'eq.'+arg.id,select:'*'});
   if(!rows.length)return reply({error:'Закрепление не найдено'},404);
   await activeProject(rows[0].project_id);
   await db('artae_pins',{id:'eq.'+arg.id},'PATCH',{note:arg.note});
   return reply({ok:true});
  }
  if(action!=='toggle')return reply({error:'Неизвестное действие'},404);
  await validateScope(project,scope,scopeId);
  if(!validItem(kind,item))return reply({error:'Недопустимый элемент'},400);
  if(kind==='message'){
   const m=await db('artae_messages',{id:'eq.'+item,deleted_at:'is.null',select:'id,conversation_id',limit:'1'});
   if(!m.length)return reply({error:'Сообщение не найдено'},404);
   if(scope==='convo'&&m[0].conversation_id!==scopeId)return reply({error:'Сообщение другого разговора'},403);
   const c=await db('artae_conversations',{id:'eq.'+m[0].conversation_id,project_id:'eq.'+project,deleted_at:'is.null',select:'id',limit:'1'});
   if(!c.length)return reply({error:'Сообщение не относится к проекту'},403);
  }
  const match={project_id:'eq.'+project,scope:'eq.'+scope,scope_id:'eq.'+scopeId,item_kind:'eq.'+kind,item_key:'eq.'+item,select:'*',limit:'1'};
  const old=await db('artae_pins',match);
  if(old.length){await db('artae_pins',{id:'eq.'+old[0].id},'DELETE');return reply({ok:true,pinned:false})}
  try{
   await db('artae_pins',{},'POST',{id:randomUUID(),project_id:project,scope,scope_id:scopeId,item_kind:kind,item_key:item,note:'',created_at:Date.now()});
  }catch(e){if(e.code!=='23505')throw e}
  return reply({ok:true,pinned:true});
 }catch(e){
  if(e.internalDb){console.error('ARTAE pins DB',e.status,e.code);return reply({error:'Ошибка хранилища закреплений'},502)}
  if(e.status&&e.status!==502&&e.status<600)return reply({error:e.message},e.status);
  console.error('ARTAE pins',e.message);
  return reply({error:'Не удалось загрузить закрепления'},502);
 }
}