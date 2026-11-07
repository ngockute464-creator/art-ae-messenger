// Durable deletion of private chat attachments after their message is erased.
// The transaction in sync.mjs records an outbox job before the original body
// is irreversibly emptied. Project folder copies are never targeted.
import {query} from './postgres.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MARKER=/\[\[chatfile:v1:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}):([^:\]\r\n]{1,360}):(\d{1,15})\]\]/gi;
const WAIT=7000;
const YD='https://cloud-api.yandex.net/v1/disk';
const nameSafe=name=>typeof name==='string'&&name.length>0&&name.length<=120&&
 name.trim()===name&&name!=='.'&&name!=='..'&&!name.endsWith('.')&&
 !/[\\/:*?"<>|\x00-\x1f]/.test(name);
export function extractChatAttachmentRefs(body){
 const refs=[],seen=new Set();
 if(typeof body!=='string')return refs;
 for(const match of body.matchAll(MARKER)){
  const id=match[1].toLowerCase();
  let name;
  try{name=decodeURIComponent(match[2])}catch{continue}
  if(!uuid.test(id)||!nameSafe(name)||seen.has(id))continue;
  seen.add(id);refs.push({fileId:id,fileName:name});
 }
 return refs;
}
const now=()=>Date.now();
let busy=false,timer=null,disabledUntil=0;
const errorText=e=>String(e?.message||e).slice(0,230);
async function leaseJobs(){
 const t=now();
 const {rows}=await query(
  'WITH due AS (SELECT message_id,file_id FROM public.artae_chat_file_deletions '+
  'WHERE finished_at IS NULL AND next_try_at<=$1 AND lease_until<$1 '+
  'ORDER BY next_try_at LIMIT 8 FOR UPDATE SKIP LOCKED) '+
  'UPDATE public.artae_chat_file_deletions d SET attempts=d.attempts+1,lease_until=$2 '+
  'FROM due WHERE d.message_id=due.message_id AND d.file_id=due.file_id '+
  'RETURNING d.message_id,d.file_id,d.file_name,d.project_id,d.attempts',
  [t,t+60000]
 );return rows;
}
async function finish(job,error=null,retained=false){
 const t=now(),attempts=job.attempts;
 const retry=!!error&&attempts<15;
 const delay=Math.min(86400000,15000*2**Math.min(13,attempts));
 await query(
  'UPDATE public.artae_chat_file_deletions SET lease_until=0,finished_at=$3,'+
  'next_try_at=$4,last_error=$5 WHERE message_id=$1 AND file_id=$2',
  [job.message_id,job.file_id,retry?null:t,retry?t+delay:t,
   retained?'Shared attachment retained':error?errorText(error):null]
 );
}
function safeProjectFolder(value){
 return typeof value==='string'&&/^app:\/[^/]+$/.test(value)&&
  value.toLowerCase()!=='app:/_system';
}
async function yandexDelete(path){
 const token=process.env.YANDEX_DISK_TOKEN;
 if(!token)throw Error('YANDEX_DISK_TOKEN missing');
 const url=new URL(YD+'/resources');
 url.searchParams.set('path',path);
 url.searchParams.set('permanently','true');
 const res=await fetch(url,{method:'DELETE',headers:{Authorization:'OAuth '+token},
  signal:AbortSignal.timeout(16000)});
 if(res.status===204||res.status===404)return;
 if(res.status===202){
  const data=await res.json().catch(()=>({}));
  if(typeof data.href!=='string')throw Error('Disk accepted asynchronous delete without operation URL');
  const op=new URL(data.href);
  if(op.origin!=='https://cloud-api.yandex.net'||
     !/^\/v1\/disk\/operations\/[A-Za-z0-9_-]{6,128}$/.test(op.pathname))
   throw Error('Invalid Yandex operation URL');
  // Never treat an accepted deletion as completed until Disk confirms it.
  const state=await fetch(op,{headers:{Authorization:'OAuth '+token},
   signal:AbortSignal.timeout(10000)});
  if(!state.ok)throw Error('Yandex operation status HTTP '+state.status);
  const result=await state.json();
  if(result.status==='success')return;
  throw Error(result.status==='failed'?'Yandex removal failed':'Yandex removal pending');
 }
 throw Error('Yandex removal HTTP '+res.status);
}
async function dispatch(job){
 try{
  const {rows:[row]}=await query(
   'SELECT p.folder_path,m.deleted_at FROM public.artae_chat_file_deletions d '+
   'JOIN public.artae_messages m ON m.id=d.message_id '+
   'JOIN public.artae_projects p ON p.id=d.project_id '+
   'WHERE d.message_id=$1 AND d.file_id=$2',
   [job.message_id,job.file_id]);
  if(!row||row.deleted_at===null||!safeProjectFolder(row.folder_path)||
     !uuid.test(job.file_id)||!nameSafe(job.file_name)){
   await finish(job,'Invalid deletion job');return;
  }
  // A pasted/reused reference in another non-deleted message must keep its file.
  const marker='[[chatfile:v1:'+job.file_id.toLowerCase()+':';
  const {rows:stillUsed}=await query(
   'SELECT 1 FROM public.artae_messages m '+
   'JOIN public.artae_conversations c ON c.id=m.conversation_id '+
   'WHERE c.project_id=$1 AND m.deleted_at IS NULL '+
   'AND POSITION($2 IN lower(m.body))>0 LIMIT 1',
   [job.project_id,marker]);
  if(stillUsed.length){await finish(job,null,true);return}
  const object=job.file_id+'__'+job.file_name;
  await yandexDelete(row.folder_path+'/!ФайлыИзЧатов/'+object);
  await finish(job);
 }catch(error){
  await finish(job,error);
  if(job.attempts===1||job.attempts===15)
   console.warn('ART-AE chat attachment cleanup:',errorText(error));
 }
}
export async function pumpChatAttachmentCleanup(){
 // Never mutate remote Disk in a migration/staging environment.
 if(process.env.ARTAE_NEXT_ALLOW_DISK_WRITES!=='1')return;
 if(busy||now()<disabledUntil)return;
 busy=true;
 try{
  const {rows:[schema]}=await query("SELECT to_regclass('public.artae_chat_file_deletions') AS name");
  if(!schema?.name){disabledUntil=now()+30000;return}
  const jobs=await leaseJobs();
  for(let i=0;i<jobs.length;i+=2)
   await Promise.all(jobs.slice(i,i+2).map(dispatch));
 }catch(error){console.error('ART-AE attachment cleanup worker:',errorText(error))}
 finally{busy=false}
}
export function startChatAttachmentCleanup(){
 if(timer)return;
 timer=setInterval(()=>{void pumpChatAttachmentCleanup()},8000);
 timer.unref?.();
 setTimeout(()=>{void pumpChatAttachmentCleanup()},1800).unref?.();
}
export function stopChatAttachmentCleanup(){
 if(timer){clearInterval(timer);timer=null}
}
