// Shared labels. All writes are project-scoped and require live ownership checks.
import {getSession} from './auth.mjs';
import {query,transaction} from './postgres.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
const reject=(message,status=400)=>Object.assign(Error(message),{status});
const origin=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const safeFile=path=>typeof path==='string'&&path.length<=500&&path.length>0&&
 !path.startsWith('/')&&!path.endsWith('/')&&!path.includes('//')&&
 path.split('/').length<=12&&path.split('/').every(p=>p&&p.length<=120&&p!=='.'&&p!=='..'&&!/[\\\x00-\x1f]/.test(p));
async function validate(project,kind,item){
 if(!uuid(project)||!['message','file'].includes(kind))throw reject('Недопустимый объект');
 const {rows:[p]}=await query('SELECT id FROM public.artae_projects WHERE id=$1 AND deleted_at IS NULL',[project]);
 if(!p)throw reject('Проект не найден',404);
 if(kind==='message'){
  if(!uuid(item))throw reject('Недопустимое сообщение');
  const {rows:[m]}=await query(
   'SELECT m.id FROM public.artae_messages m JOIN public.artae_conversations c ON c.id=m.conversation_id '+
   'WHERE m.id=$1 AND c.project_id=$2 AND m.deleted_at IS NULL AND c.deleted_at IS NULL',[item,project]);
  if(!m)throw reject('Сообщение не найдено',404);
 }else if(!safeFile(item))throw reject('Недопустимый путь файла');
}
function namesOf(value){
 if(!Array.isArray(value)||value.length>12)throw reject('Не более 12 меток');
 const names=value.map(x=>typeof x==='string'?x.trim():null);
 if(names.some(n=>!n||n.length>40||/[\x00-\x1f]/.test(n)))throw reject('Недопустимая метка');
 return [...new Set(names)];
}
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&(!origin(req)||!req.headers.get('content-type')?.startsWith('application/json')))
  return reply({error:'Недопустимый запрос'},403);
 try{
  const session=await getSession(req);
  if(!session)return reply({error:'Требуется вход'},401);
  if(req.method==='GET'){
   const project=new URL(req.url).searchParams.get('project');
   if(!uuid(project))throw reject('Недопустимый проект');
   const {rows:[p]}=await query('SELECT id FROM public.artae_projects WHERE id=$1 AND deleted_at IS NULL',[project]);
   if(!p)throw reject('Проект не найден',404);
   const {rows}=await query(
    'SELECT item_kind AS kind,item_key AS item,name FROM public.artae_labels WHERE project_id=$1 ORDER BY created_at ASC LIMIT 5000',[project]);
   return reply({labels:rows});
  }
  const arg=await req.json();
  if(!arg||typeof arg!=='object'||Array.isArray(arg))throw reject('Неправильный JSON');
  const {action,project,kind,item}=arg;
  if(action==='set'){
   await validate(project,kind,item);
   const names=namesOf(arg.names);
   const expected=namesOf(arg.expectedNames);
   // Serialize only edits to this project/object; reject stale drafts instead
   // of silently merging or losing another user's changes.
   const result=await transaction(async tx=>{
    await tx('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',
     [project+'|'+kind+'|'+item]);
    const {rows:existing}=await tx(
     'SELECT name FROM public.artae_labels WHERE project_id=$1 AND item_kind=$2 AND item_key=$3 ORDER BY name',
     [project,kind,item]);
    const current=existing.map(row=>row.name).sort();
    if(JSON.stringify(current)!==JSON.stringify([...expected].sort()))
     return {conflict:true,names:current};
    await tx('DELETE FROM public.artae_labels WHERE project_id=$1 AND item_kind=$2 AND item_key=$3',[project,kind,item]);
    for(const name of names)await tx(
     'INSERT INTO public.artae_labels(project_id,item_kind,item_key,name,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)',
     [project,kind,item,name,session.user.id,Date.now()]);
    return {ok:true};
   });
   if(result.conflict)return reply({error:'Метки изменены другим участником. Обновите и повторите.',names:result.names},409);
   return reply({ok:true});
  }
  return reply({error:'Неизвестное действие'},404);
 }catch(e){
  if(e.status&&e.status<500)return reply({error:e.message},e.status);
  console.error('ARTAE labels:',e.code||'',e.message);
  return reply({error:'Метки временно недоступны'},503);
 }
}
