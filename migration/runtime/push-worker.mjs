// Durable background deliveries, no session credentials in push payload.
import {query} from './postgres.mjs';
import {sendWebPush,hasVapid} from './push-transport.mjs';
const clock=()=>Date.now();
let busy=false,timer=null;
const payload=convo=>({title:'АРТ-АЕ',body:'Новое сообщение',conversation:convo});
async function leaseDeliveries(){
 const t=clock();
 const {rows}=await query(
  'WITH due AS ('+
  'SELECT message_id,subscription_id FROM public.artae_push_deliveries '+
  'WHERE finished_at IS NULL AND next_try_at <= $1 AND lease_until < $1 '+
  'ORDER BY next_try_at LIMIT 12 FOR UPDATE SKIP LOCKED) '+
  'UPDATE public.artae_push_deliveries d SET lease_until=$2,attempts=d.attempts+1 '+
  'FROM due WHERE d.message_id=due.message_id AND d.subscription_id=due.subscription_id '+
  'RETURNING d.message_id,d.subscription_id,d.recipient_user_id,d.attempts',
  [t,t+45000]);
 return rows;
}
async function finish(job,err=''){
 const t=clock();
 const retry=!!err&&job.attempts<6;
 const delay=Math.min(900000,Math.round(10000*Math.pow(3,job.attempts)));
 await query(
  'UPDATE public.artae_push_deliveries SET lease_until=0,finished_at=$3,'+
  'next_try_at=$4,last_error=$5 WHERE message_id=$1 AND subscription_id=$2',
  [job.message_id,job.subscription_id,retry?null:t,retry?t+delay:t,err?String(err).slice(0,240):null]);
}
async function dispatch(job){
 const {rows:[r]}=await query(
  'SELECT s.endpoint,s.p256dh,s.auth_key,m.conversation_id '+
  'FROM public.artae_push_deliveries d '+
  'JOIN public.artae_push_subscriptions s ON s.id=d.subscription_id '+
  'JOIN public.artae_sessions x ON x.sid=s.session_sid '+
  'JOIN public.artae_users u ON u.id=s.user_id '+
  'JOIN public.artae_messages m ON m.id=d.message_id '+
  'JOIN public.artae_conversations c ON c.id=m.conversation_id '+
  'JOIN public.artae_projects p ON p.id=c.project_id '+
  'LEFT JOIN public.artae_message_reads reads ON reads.message_id=m.id AND reads.user_id=d.recipient_user_id '+
  'WHERE d.message_id=$1 AND d.subscription_id=$2 AND s.user_id=d.recipient_user_id '+
  'AND u.disabled=false AND u.generation=x.generation AND x.last_seen>$3 '+
  'AND m.author_id<>d.recipient_user_id AND m.deleted_at IS NULL '+
  'AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND reads.message_id IS NULL',
  [job.message_id,job.subscription_id,clock()-180*86400000]);
 if(!r){await finish(job);return}
 try{
  await sendWebPush({endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth_key}},
   payload(r.conversation_id));
  await finish(job);
 }catch(error){
  const status=Number(error?.statusCode||error?.status||0);
  if(status===404||status===410){
   await query('DELETE FROM public.artae_push_subscriptions WHERE id=$1',[job.subscription_id]);
  }else{
   const permanent=status===400||status===401||status===403;
   await finish(permanent?{...job,attempts:6}:job,'HTTP '+(status||'?')+': '+(error?.message||'Push failed'));
  }
 }
}
export async function pumpPush(){
 if(busy||!hasVapid())return;
 busy=true;
 try{
  const jobs=await leaseDeliveries();
  for(let i=0;i<jobs.length;i+=3)
   await Promise.all(jobs.slice(i,i+3).map(job=>dispatch(job)));
 }catch(error){console.error('ART-AE push worker:',error?.message||error)}
 finally{busy=false}
}
export function startPushWorker(){
 if(timer)return;
 timer=setInterval(()=>{void pumpPush()},5000);
 timer.unref?.();
 setTimeout(()=>{void pumpPush()},1500).unref?.();
}
export function stopPushWorker(){
 if(timer){clearInterval(timer);timer=null}
}
