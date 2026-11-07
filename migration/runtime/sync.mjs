// ART-AE local projects, conversations, messages API.
// Compatible with server/sync-pg.mjs wire contract. PostgreSQL only.
// IMPORTANT: Yandex Disk folder creation/rename is intentionally disabled
// until an isolated integration is configured (M2 files phase).
import {randomUUID} from 'node:crypto';
import {getSession} from './auth.mjs';
import {query, transaction} from './postgres.mjs';
import {messageStats,markMessagesRead} from './unread.mjs';
import {renameProjectFolder, folderForName} from './project-rename.mjs';
import {extractChatAttachmentRefs} from './chat-attachment-cleanup.mjs';

const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const clean=(x,max)=>typeof x==='string'?x.trim().slice(0,max):'';
const now=()=>Date.now();
const avatarOk=x=>x===null||(typeof x==='string'&&x.length<=80000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x));
const originOk=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const projectView=r=>({id:r.id,name:r.name,folderPath:r.folder_path,avatar:r.avatar,createdAt:Number(r.created_at),createdBy:r.created_by,updatedAt:r.updated_at===null?null:Number(r.updated_at)});
const convoView=r=>({id:r.id,name:r.name,project:r.project_id,avatar:r.avatar,createdAt:Number(r.created_at),updatedAt:r.updated_at===null?null:Number(r.updated_at)});
const messageView=r=>({id:r.id,convo:r.conversation_id,authorId:r.author_id,who:r.author_name,text:r.deleted_at===null?r.body:'',time:Number(r.created_at),editedAt:r.edited_at===null?null:Number(r.edited_at),deletedAt:r.deleted_at===null?null:Number(r.deleted_at)});

async function one(table,id) {
  if(!uuid(id))return null;
  const t={project:'artae_projects',convo:'artae_conversations',message:'artae_messages'}[table];
  if(!t)throw Error('Unknown table');
  const {rows:[r]}=await query('SELECT * FROM public.'+t+' WHERE id=$1',[id]);
  return r??null;
}
async function activeProject(id) {
  const p=await one('project',id);return p&&p.deleted_at===null?p:null;
}
async function activeConvo(id) {
  const c=await one('convo',id);
  return c&&c.deleted_at===null&&await activeProject(c.project_id)?c:null;
}
function failed(e) {
  if([400,403,404,409,503].includes(e.status))return reply({error:e.message},e.status);
  if(e.code==='23505')return reply({error:'Запись уже существует'},409);
  if(e.code==='23503')return reply({error:'Связанная запись не существует'},409);
  console.error('ARTAE local sync:',e.code,e.message);
  return reply({error:'Ошибка работы с базой данных. Повторите попытку.'},502);
}
function requireDiskWrites(){
 if(process.env.ARTAE_NEXT_ALLOW_DISK_WRITES!=='1')
  throw Object.assign(Error('Запись на Яндекс Диск пока отключена'),{status:503});
}
async function createProjectFolder(name){
 requireDiskWrites();
 const token=process.env.YANDEX_DISK_TOKEN;
 if(!token)throw Object.assign(Error('Яндекс Диск не настроен'),{status:503});
 const path=folderForName(name);
 const url=new URL('https://cloud-api.yandex.net/v1/disk/resources');
 url.searchParams.set('path',path);
 const response=await fetch(url,{method:'PUT',headers:{Authorization:'OAuth '+token},signal:AbortSignal.timeout(12000)});
 if(response.status===409)throw Object.assign(Error('Папка проекта уже существует на Яндекс Диске'),{status:409});
 if(!response.ok)throw Error('Yandex folder create failed: '+response.status);
 return path;
}
async function projectRenameDb(table,params={},options={}){
 if(table!=='project'||typeof params.id!=='string'||!params.id.startsWith('eq.'))
  throw Error('Unexpected project rename query');
 const id=params.id.slice(3);
 if(!uuid(id))throw Error('Invalid project ID');
 if(options.method!=='PATCH'){
  const {rows}=await query('SELECT * FROM public.artae_projects WHERE id=$1',[id]);
  return rows;
 }
 if(typeof params.folder_path!=='string'||!params.folder_path.startsWith('eq.')||params.deleted_at!=='is.null')
  throw Error('Invalid folder compare-and-set');
 const patch=options.body||{};
 const permitted=['name','updated_at','avatar','folder_path'];
 if(!Object.keys(patch).length||Object.keys(patch).some(k=>!permitted.includes(k)))
  throw Error('Unexpected project patch');
 const {rows}=await query(
  'UPDATE public.artae_projects SET name=$1, updated_at=$2,'+
  ' avatar=CASE WHEN $3::boolean THEN $4 ELSE avatar END,'+
  ' folder_path=CASE WHEN $5::boolean THEN $6 ELSE folder_path END'+
  ' WHERE id=$7 AND folder_path=$8 AND deleted_at IS NULL RETURNING *',
  [patch.name,patch.updated_at,Object.hasOwn(patch,'avatar'),patch.avatar??null,
   Object.hasOwn(patch,'folder_path'),patch.folder_path??null,id,params.folder_path.slice(3)]
 );
 return rows;
}

async function listMessages(id,since,paging,pageToken) {
  if(!uuid(id))return reply({error:'Invalid conversation'},400);
  if(!await activeConvo(id))return reply({error:'Беседа не найдена'},404);
  if(!Number.isSafeInteger(since)||since<0)return reply({error:'Invalid cursor'},400);
  const cutoff=Math.max(0,since-15000);
  if(!paging) {
    const args=[id];
    let where='conversation_id=$1';
    if(since>0) {args.push(cutoff);where+=' AND (created_at >= $2 OR edited_at >= $2 OR deleted_at >= $2)'}
    const {rows}=await query('SELECT * FROM public.artae_messages WHERE '+where+' ORDER BY created_at ASC,id ASC LIMIT 1000',args);
    return reply({messages:rows.map(messageView),cursor:now(),initial:since===0});
  }

  let watermark=now(),last=null;
  if(pageToken) {
    if(pageToken.length>350)return reply({error:'Invalid page'},400);
    try {
      const p=JSON.parse(Buffer.from(pageToken,'base64url').toString('utf8'));
      if(p.v!==1||p.convo!==id||p.since!==since||!Number.isSafeInteger(p.watermark)||
        p.watermark<0||p.watermark>now()+60000||!Number.isSafeInteger(p.created)||p.created<0||!uuid(p.id))
        throw Error('Invalid page');
      watermark=p.watermark;last={created:p.created,id:p.id};
    } catch {return reply({error:'Invalid page'},400)}
  }
  const args=[id,watermark];
  let where='conversation_id=$1 AND created_at <= $2';
  if(since>0) {args.push(cutoff);where+=' AND (created_at >= $3 OR edited_at >= $3 OR deleted_at >= $3)'}
  if(last) {
    args.push(last.created,last.id);
    const n=args.length;
    where+=' AND (created_at > $'+(n-1)+' OR (created_at = $'+(n-1)+' AND id > $'+n+'))';
  }
  const {rows}=await query('SELECT * FROM public.artae_messages WHERE '+where+' ORDER BY created_at ASC,id ASC LIMIT 251',args);
  const messages=rows.slice(0,250),hasMore=rows.length>250,lastRow=messages.at(-1);
  const nextCursor=hasMore&&lastRow?
    Buffer.from(JSON.stringify({v:1,convo:id,since,watermark,created:Number(lastRow.created_at),id:lastRow.id})).toString('base64url'):null;
  return reply({messages:messages.map(messageView),cursor:watermark,initial:since===0,hasMore,nextCursor});
}

export default async function handler(req) {
  if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
  if(req.method==='POST'&&(!originOk(req)||!req.headers.get('content-type')?.startsWith('application/json')))
    return reply({error:'Invalid origin'},403);
  try {
    const session=await getSession(req);
    if(!session)return reply({error:'Требуется вход'},401);
    let body={};
    if(req.method==='POST') {
      try {body=await req.json()} catch{return reply({error:'Invalid JSON'},400)}
      if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid JSON'},400);
    }
    const url=new URL(req.url),action=req.method==='GET'?url.searchParams.get('action'):body.action;
    if(action==='messageStats'&&req.method==='GET') {
      return reply({conversations:await messageStats(session.user.id)});
    }
    if(action==='markRead'&&req.method==='POST') {
      if(!uuid(body.convo)||!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>100||
         body.ids.some(id=>!uuid(id)))return reply({error:'Некорректный список сообщений'},400);
      if(!await activeConvo(body.convo))return reply({error:'Разговор не найден'},404);
      return reply(await markMessagesRead(session.user.id,body.convo,[...new Set(body.ids)]));
    }
    if(action==='overview'&&req.method==='GET') {
      const [projects,convos]=await Promise.all([
        query('SELECT * FROM public.artae_projects WHERE deleted_at IS NULL ORDER BY created_at ASC'),
        query('SELECT c.* FROM public.artae_conversations c JOIN public.artae_projects p ON p.id=c.project_id WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY c.created_at ASC')
      ]);
      return reply({projects:projects.rows.map(projectView),convos:convos.rows.map(convoView)});
    }
    if(action==='deletedProjects'&&req.method==='GET') {
      if(session.user.role!=='admin')return reply({error:'Доступ только администратору'},403);
      const {rows}=await query('SELECT id,name,deleted_at FROM public.artae_projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
      return reply({projects:rows.map(p=>({id:p.id,name:p.name,deletedAt:Number(p.deleted_at)}))});
    }
    if(action==='deleteProject'&&req.method==='POST') {
      if(session.user.role!=='admin')return reply({error:'Доступ только администратору'},403);
      if(!uuid(body.id))return reply({error:'Недопустимый проект'},400);
      const current=await activeProject(body.id);
      if(!current)return reply({error:'Проект не найден или уже удалён'},404);
      if(body.confirmName!==current.name)return reply({error:'Название проекта не совпадает'},400);
      const stamp=now();
      const {rowCount}=await query('UPDATE public.artae_projects SET deleted_at=$2,updated_at=$2 WHERE id=$1 AND deleted_at IS NULL',[body.id,stamp]);
      if(rowCount!==1)return reply({error:'Проект уже изменён'},409);
      return reply({ok:true,id:body.id});
    }
    if(action==='restoreProject'&&req.method==='POST') {
      if(session.user.role!=='admin')return reply({error:'Доступ только администратору'},403);
      if(!uuid(body.id))return reply({error:'Недопустимый проект'},400);
      const restored=await transaction(async tx=>{
        await tx('SELECT pg_advisory_xact_lock(20261107,2)');
        const {rows:[p]}=await tx('SELECT * FROM public.artae_projects WHERE id=$1 AND deleted_at IS NOT NULL',[body.id]);
        if(!p)return {status:404};
        const {rows:existing}=await tx('SELECT id,name,folder_path FROM public.artae_projects WHERE deleted_at IS NULL');
        if(existing.some(other=>other.name.toLocaleLowerCase('ru')===p.name.toLocaleLowerCase('ru') ||
          (p.folder_path!==null&&other.folder_path===p.folder_path)))return {status:409};
        const {rows:[updated]}=await tx(
          'UPDATE public.artae_projects SET deleted_at=NULL,updated_at=$2 WHERE id=$1 AND deleted_at IS NOT NULL RETURNING *',
          [p.id,now()]);
        return updated?{project:updated}:{status:409};
      });
      if(restored.status===404)return reply({error:'Удалённый проект не найден'},404);
      if(restored.status===409)return reply({error:'Существует активный проект с таким именем или папкой. Сначала устраните конфликт.'},409);
      return reply({ok:true,project:projectView(restored.project)});
    }
    if(action==='createProject'&&req.method==='POST'){
      const name=clean(body.name,100);
      if(!name)return reply({error:'Введите имя проекта'},400);
      requireDiskWrites();
      const path=folderForName(name);
      const {rows:existing}=await query('SELECT name,folder_path FROM public.artae_projects');
      if(existing.some(p=>p.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')||
        p.folder_path?.toLocaleLowerCase('ru')===path.toLocaleLowerCase('ru')))
        return reply({error:'Название или папка зарезервированы существующим либо удалённым проектом. Сначала восстановите его.'},409);
      const folder=await createProjectFolder(name);
      const {rows:[created]}=await query(
        'INSERT INTO public.artae_projects(id,name,folder_path,created_by,created_at) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [randomUUID(),name,folder,session.user.id,now()]
      );
      return reply({project:projectView(created)});
    }
    if(action==='updateProject'&&req.method==='POST'){
      const current=await activeProject(body.id);
      if(!current)return reply({error:'Проект не найден'},404);
      const name=clean(body.name,100);
      if(!name)return reply({error:'Введите имя проекта'},400);
      if(body.avatar!==undefined&&!avatarOk(body.avatar))return reply({error:'Недопустимый аватар'},400);
      if(name!==current.name){
        requireDiskWrites();
        const path=folderForName(name);
        const {rows:existing}=await query('SELECT id,name,folder_path FROM public.artae_projects');
        if(existing.some(p=>p.id!==current.id&&(p.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')||
          p.folder_path?.toLocaleLowerCase('ru')===path.toLocaleLowerCase('ru'))))
          return reply({error:'Название или папка уже заняты активным либо удалённым проектом'},409);
      }
      const updated=await renameProjectFolder({oldProject:current,name,db:projectRenameDb,
        avatarProvided:body.avatar!==undefined,avatar:body.avatar});
      return reply({project:projectView(updated)});
    }
    if(action==='createConvo'&&req.method==='POST') {
      if(!await activeProject(body.project))return reply({error:'Проект не найден'},404);
      const name=clean(body.name,100);
      if(!name)return reply({error:'Введите имя беседы'},400);
      const {rows:[c]}=await query(
        'INSERT INTO public.artae_conversations(id,project_id,name,created_at) VALUES($1,$2,$3,$4) RETURNING *',
        [randomUUID(),body.project,name,now()]
      );
      return reply({convo:convoView(c)});
    }
    if(action==='updateConvo'&&req.method==='POST') {
      if(!await activeConvo(body.id))return reply({error:'Беседа не найдена'},404);
      const name=clean(body.name,100);
      if(!name)return reply({error:'Введите имя беседы'},400);
      if(body.avatar!==undefined&&!avatarOk(body.avatar))return reply({error:'Недопустимый аватар'},400);
      const {rows:[updated]}=await query(
        'UPDATE public.artae_conversations SET name=$2,avatar=CASE WHEN $3::boolean THEN $4 ELSE avatar END,updated_at=$5 WHERE id=$1 AND deleted_at IS NULL RETURNING *',
        [body.id,name,body.avatar!==undefined,body.avatar??null,now()]
      );
      if(!updated)return reply({error:'Беседа уже изменена'},409);
      return reply({convo:convoView(updated)});
    }
    if(action==='messages'&&req.method==='GET') {
      const since=Number(url.searchParams.get('since')||0);
      return listMessages(url.searchParams.get('convo'),since,url.searchParams.get('paging')==='1',url.searchParams.get('page'));
    }
    if(action==='send'&&req.method==='POST') {
      if(!await activeConvo(body.convo))return reply({error:'Беседа не найдена'},404);
      const text=clean(body.text,6000);
      if(!text)return reply({error:'Введите сообщение'},400);
      const id=uuid(body.requestId)?body.requestId:randomUUID();
      const {inserted}=await transaction(async tx=>{
        const stamp=now();
        const {rows:[inserted]}=await tx(
          'INSERT INTO public.artae_messages(id,conversation_id,author_id,author_name,body,created_at) '+
          'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING RETURNING *',
          [id,body.convo,session.user.id,session.user.name,text,stamp]
        );
        if(inserted){
          await tx(
            'INSERT INTO public.artae_push_deliveries '+
            '(message_id,subscription_id,recipient_user_id,created_at,next_try_at) '+
            'SELECT $1,s.id,s.user_id,$2,$2 '+
            'FROM public.artae_push_subscriptions s '+
            'JOIN public.artae_users u ON u.id=s.user_id '+
            'JOIN public.artae_sessions x ON x.sid=s.session_sid '+
            'WHERE s.user_id<>$3 AND u.disabled=false AND u.generation=x.generation '+
            'AND x.last_seen>$4 ON CONFLICT(message_id,subscription_id) DO NOTHING',
            [id,stamp,session.user.id,stamp-180*86400000]
          );
        }
        return {inserted};
      });
      if(inserted)return reply({message:messageView(inserted)});
      const old=await one('message',id);
      if(!old||old.author_id!==session.user.id||old.body!==text||old.conversation_id!==body.convo)
        return reply({error:'Конфликт идентификатора сообщения'},409);
      return reply({message:messageView(old),repeated:true});
    }
    if((action==='edit'||action==='delete')&&req.method==='POST') {
      const m=await one('message',body.id);
      if(!m||m.conversation_id!==body.convo||m.deleted_at!==null||!await activeConvo(body.convo))
        return reply({error:'Сообщение не найдено'},404);
      if(m.author_id!==session.user.id)return reply({error:'Можно изменять только свои сообщения'},403);
      if(!Object.hasOwn(body,'expectedEditedAt')||
        !(body.expectedEditedAt===null||(Number.isSafeInteger(body.expectedEditedAt)&&body.expectedEditedAt>=0)))
        return reply({error:'Обновите сообщение перед изменением'},409);
      const revision=m.edited_at===null?null:Number(m.edited_at);
      if(body.expectedEditedAt!==revision)
        return reply({error:'Сообщение изменено на другом устройстве. Обновите беседу и повторите действие.'},409);
      const stamp=Math.max(now(),(revision||0)+1);
      const value=action==='edit'?clean(body.text,6000):null;
      if(action==='edit'&&!value)return reply({error:'Сообщение не может быть пустым'},400);
      const isEdit=action==='edit';
      const updated=await transaction(async tx=>{
        const {rows:[changed]}=await tx(
          isEdit?
            'UPDATE public.artae_messages SET body=$4,edited_at=$5 WHERE id=$1 AND conversation_id=$2 AND author_id=$3 AND deleted_at IS NULL AND edited_at IS NOT DISTINCT FROM $6::bigint RETURNING *':
            'UPDATE public.artae_messages SET body=\'\',deleted_at=$4 WHERE id=$1 AND conversation_id=$2 AND author_id=$3 AND deleted_at IS NULL AND edited_at IS NOT DISTINCT FROM $5::bigint RETURNING *',
          isEdit?
            [body.id,body.convo,session.user.id,value,stamp,revision]:
            [body.id,body.convo,session.user.id,stamp,revision]
        );
        if(!changed||isEdit)return changed;
        // The original body is erased. Persist file deletion jobs in this SAME
        // PostgreSQL transaction or roll back the message deletion entirely.
        const attachments=extractChatAttachmentRefs(m.body);
        if(attachments.length){
          const {rows:[convoRecord]}=await tx(
            'SELECT project_id FROM public.artae_conversations WHERE id=$1',[body.convo]);
          if(!convoRecord)throw Error('Conversation missing during cleanup');
          for(const file of attachments){
            await tx(
              'INSERT INTO public.artae_chat_file_deletions '+
              '(message_id,project_id,file_id,file_name,created_at,next_try_at) '+
              'VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(message_id,file_id) DO NOTHING',
              [body.id,convoRecord.project_id,file.fileId,file.fileName,stamp]
            );
          }
        }
        return changed;
      });
      if(!updated)return reply({error:'Сообщение уже изменено'},409);
      return reply({message:messageView(updated)});
    }
    return reply({error:'Unknown action'},404);
  } catch(e) {return failed(e)}
}
