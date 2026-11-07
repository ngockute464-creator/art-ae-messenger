// ART-AE local shared pins API (project and conversation scopes).
// Preserves existing wire contract. Local PostgreSQL only; does not access Supabase.
// Yandex Disk verification is disabled until isolated file integration is available.
import {randomUUID} from 'node:crypto';
import {getSession} from './auth.mjs';
import {query} from './postgres.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(value,status=200)=>Response.json(value,{status,headers});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const failure=(message,status=400)=>Object.assign(Error(message),{status});
const sameOrigin=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const mapPin=p=>({
  id:p.id,kind:p.item_kind,item:p.item_key,scope:p.scope,scopeId:p.scope_id,
  project:p.project_id,note:p.note||'',createdAt:Number(p.created_at),
  previewText:p.item_kind==='message'?p.message_body:p.item_key,
  convoId:p.message_convo||null
});

async function activeProject(id) {
  if(!uuid(id))throw failure('Недопустимый проект',400);
  const {rows:[p]}=await query('SELECT id FROM public.artae_projects WHERE id=$1 AND deleted_at IS NULL',[id]);
  if(!p)throw failure('Проект не найден',404);
  return id;
}
async function validateScope(project,scope,scopeId) {
  await activeProject(project);
  if(!['project','convo'].includes(scope)||!uuid(scopeId))throw failure('Недопустимая область');
  if(scope==='project') {
    if(scopeId!==project)throw failure('Несовпадение проекта');
    return;
  }
  const {rows:[c]}=await query(
    'SELECT id FROM public.artae_conversations WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL',
    [scopeId,project]
  );
  if(!c)throw failure('Разговор не найден',404);
}
function validItem(kind,item){
  if(kind==='message')return uuid(item);
  if(kind!=='file'||typeof item!=='string'||!item||item.length>500||
     item.startsWith('/')||item.endsWith('/')||item.includes('//'))return false;
  const parts=item.split('/');
  return parts.length<=12&&parts.every(x=>x.length>0&&x.length<=120&&x!=='.'&&x!=='..'&&!/[\\\x00-\x1f]/.test(x));
}
async function getPin(id,fileOnly=false) {
  if(!uuid(id))return null;
  const {rows:[r]}=await query(
    'SELECT * FROM public.artae_pins WHERE id=$1'+(fileOnly?" AND item_kind='file'":''),
    [id]
  );
  return r||null;
}

export default async function handler(req) {
  if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
  if(req.method==='POST'&&(!sameOrigin(req)||!req.headers.get('content-type')?.startsWith('application/json')))
    return reply({error:'Недопустимый запрос'},403);
  try {
    if(!await getSession(req))return reply({error:'Требуется вход'},401);
    if(req.method==='GET') {
      const project=new URL(req.url).searchParams.get('project');
      await activeProject(project);
      const {rows}=await query(
        'SELECT p.*,m.body AS message_body,m.conversation_id AS message_convo,m.deleted_at AS message_deleted '+
        'FROM (SELECT * FROM public.artae_pins WHERE project_id=$1 ORDER BY created_at DESC LIMIT 500) p '+
        'LEFT JOIN public.artae_messages m ON p.item_kind=\'message\' AND m.id::text=p.item_key',
        [project]
      );
      const pins=rows.filter(p=>p.item_kind!=='message'||(p.message_convo!==null&&p.message_deleted===null));
      return reply({pins:pins.map(mapPin)});
    }
    let arg={};
    try{arg=await req.json()}catch{return reply({error:'Неправильный JSON'},400)}
    if(!arg||typeof arg!=='object'||Array.isArray(arg))return reply({error:'Неправильный JSON'},400);
    const {action,project,scope,scopeId,kind,item}=arg;

    if(action==='remove'){
      if(!uuid(arg.id))return reply({error:'Неверное закрепление'},400);
      const pin=await getPin(arg.id);
      if(!pin)return reply({ok:true});
      await activeProject(pin.project_id);
      await query('DELETE FROM public.artae_pins WHERE id=$1',[arg.id]);
      return reply({ok:true});
    }
    if(action==='verifyMissing'){
      if(!uuid(arg.id))return reply({error:'Неверное закрепление'},400);
      const pin=await getPin(arg.id,true);
      if(!pin)return reply({ok:true,removed:false});
      await activeProject(pin.project_id);
      if(!validItem('file',pin.item_key))return reply({error:'Недопустимый файл'},400);
      // Never ask the live Yandex Disk for existence and then delete records
      // from the migration copy without an explicit isolated storage setup.
      return reply({error:'Проверка файла на Яндекс Диске пока не подключена'},503);
    }
    if(action==='note') {
      if(!uuid(arg.id)||typeof arg.note!=='string'||arg.note.length>300)
        return reply({error:'Недопустимое примечание'},400);
      const pin=await getPin(arg.id);
      if(!pin)return reply({error:'Закрепление не найдено'},404);
      await activeProject(pin.project_id);
      await query('UPDATE public.artae_pins SET note=$1 WHERE id=$2',[arg.note,arg.id]);
      return reply({ok:true});
    }
    if(action!=='toggle')return reply({error:'Неизвестное действие'},404);
    await validateScope(project,scope,scopeId);
    if(!validItem(kind,item))return reply({error:'Недопустимый элемент'},400);
    if(kind==='message') {
      const {rows:[m]}=await query(
        'SELECT m.id,m.conversation_id,c.project_id FROM public.artae_messages m '+
        'JOIN public.artae_conversations c ON c.id=m.conversation_id '+
        'WHERE m.id=$1 AND m.deleted_at IS NULL AND c.deleted_at IS NULL',
        [item]
      );
      if(!m) return reply({error:'Сообщение не найдено'},404);
      if(scope==='convo'&&m.conversation_id!==scopeId)
        return reply({error:'Сообщение другого разговора'},403);
      if(m.project_id!==project)return reply({error:'Сообщение не относится к проекту'},403);
    }
    const args=[project,scope,scopeId,kind,item];
    const {rows:[old]}=await query(
      'SELECT id FROM public.artae_pins WHERE project_id=$1 AND scope=$2 AND scope_id=$3 AND item_kind=$4 AND item_key=$5',
      args
    );
    if(old){
      await query('DELETE FROM public.artae_pins WHERE id=$1',[old.id]);
      return reply({ok:true,pinned:false});
    }
    await query(
      'INSERT INTO public.artae_pins(id,project_id,scope,scope_id,item_kind,item_key,note,created_at) '+
      "VALUES($1,$2,$3,$4,$5,$6,'',$7) ON CONFLICT(project_id,scope,scope_id,item_kind,item_key) DO NOTHING",
      [randomUUID(),...args,Date.now()]
    );
    return reply({ok:true,pinned:true});
  } catch(error) {
    if(error.status&&error.status<600)return reply({error:error.message},error.status);
    console.error('ARTAE-NEXT pins',error.code,error.message);
    return reply({error:'Не удалось загрузить закрепления'},502);
  }
}
