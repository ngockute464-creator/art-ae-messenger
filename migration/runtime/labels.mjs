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
   // Single transaction makes edits atomic: never lose old labels on failure.
   await transaction(async tx=>{
    await tx('DELETE FROM public.artae_labels WHERE project_id=$1 AND item_kind=$2 AND item_key=$3',[project,kind,item]);
    for(const name of names)await tx(
     'INSERT INTO public.artae_labels(project_id,item_kind,item_key,name,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)',
     [project,kind,item,name,session.user.id,Date.now()]);
   });
   return reply({ok:true});
  }
  if(action==='importLegacy'){
   // Legacy browsers did not record a project per label. Resolve message
   // ownership in PostgreSQL; never guess from the currently open project.
   if(!Array.isArray(arg.labels)||arg.labels.length>200)throw reject('Недопустимый импорт');
   const valid=[];
   for(const row of arg.labels){
    if(!row||row.kind!=='message'||!uuid(row.item))continue;
    const names=namesOf(row.names);
    const {rows:[m]}=await query(
     'SELECT c.project_id FROM public.artae_messages m '+
     'JOIN public.artae_conversations c ON c.id=m.conversation_id '+
     'JOIN public.artae_projects p ON p.id=c.project_id '+
     'WHERE m.id=$1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL',
     [row.item]);
    if(m)valid.push({project:m.project_id,item:row.item,names});
   }
   await transaction(async tx=>{
    for(const row of valid)for(const name of row.names)await tx(
     'INSERT INTO public.artae_labels(project_id,item_kind,item_key,name,created_by,created_at) '+
     "VALUES($1,'message',$2,$3,$4,$5) ON CONFLICT DO NOTHING",
     [row.project,row.item,name,session.user.id,Date.now()]);
   });
   return reply({ok:true,imported:valid.map(({project,item,names})=>({project,item,names}))});
  }
  if(action==='merge'){
   if(!Array.isArray(arg.labels)||arg.labels.length>300)throw reject('Недопустимый импорт');
   const rows=[];
   for(const entry of arg.labels){
    if(!entry||typeof entry!=='object')throw reject('Недопустимый импорт');
    await validate(project,entry.kind,entry.item);
    rows.push({kind:entry.kind,item:entry.item,names:namesOf(entry.names)});
   }
   await transaction(async tx=>{
    for(const row of rows)for(const name of row.names)await tx(
     'INSERT INTO public.artae_labels(project_id,item_kind,item_key,name,created_by,created_at) '+
     'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
     [project,row.kind,row.item,name,session.user.id,Date.now()]);
   });
   return reply({ok:true});
  }
  return reply({error:'Неизвестное действие'},404);
 }catch(e){
  if(e.status&&e.status<500)return reply({error:e.message},e.status);
  console.error('ARTAE labels:',e.code||'',e.message);
  return reply({error:'Метки временно недоступны'},503);
 }
}
