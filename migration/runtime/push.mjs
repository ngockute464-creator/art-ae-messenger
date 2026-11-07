// Authenticated Push API. Subscriptions belong to a user AND a specific session.
import {createHash,randomUUID} from 'node:crypto';
import {getSession} from './auth.mjs';
import {query,transaction} from './postgres.mjs';
import {hasVapid,sendWebPush} from './push-transport.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(body,status=200)=>Response.json(body,{status,headers});
const digest=value=>createHash('sha256').update(value).digest('hex');
const originOk=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const hostOk=host=>
 ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(host) ||
 host.endsWith('.push.apple.com')||
 host.endsWith('.push.services.mozilla.com')||
 host.endsWith('.notify.windows.com');
function validSubscription(value){
 if(!value||typeof value!=='object'||typeof value.endpoint!=='string'||!value.keys)return null;
 const endpoint=value.endpoint;
 if(endpoint.length>2048||endpoint.length<30)return null;
 let url;
 try{url=new URL(endpoint)}catch{return null}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!hostOk(url.hostname.toLowerCase()))return null;
 const {p256dh,auth}=value.keys;
 if(typeof p256dh!=='string'||typeof auth!=='string')return null;
 if(!/^[A-Za-z0-9_-]{40,200}$/.test(p256dh)||!/^[A-Za-z0-9_-]{16,90}$/.test(auth))return null;
 return {endpoint,p256dh,auth,hash:digest(endpoint)};
}
let testTimes=new Map();
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&(!originOk(req)||!req.headers.get('content-type')?.startsWith('application/json')))
  return reply({error:'Invalid origin'},403);
 try{
  const session=await getSession(req);
  if(!session)return reply({error:'Требуется вход'},401);
  const action=req.method==='GET'?new URL(req.url).searchParams.get('action'):null;
  if(req.method==='GET'){
   if(action!=='config')return reply({error:'Unknown action'},404);
   return reply({enabled:hasVapid(),publicKey:hasVapid()?process.env.ARTAE_VAPID_PUBLIC_KEY:null});
  }
  const body=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Bad request'},400);
  if(!hasVapid())return reply({error:'Push ещё не настроен'},503);
  if(body.action==='subscribe'){
   const sub=validSubscription(body.subscription);
   if(!sub)return reply({error:'Недопустимая подписка устройства'},400);
   await transaction(async tx=>{
    // If a push endpoint changes owner, prevent any queued jobs for its old owner.
    await tx('DELETE FROM public.artae_push_deliveries WHERE subscription_id IN '+
     '(SELECT id FROM public.artae_push_subscriptions WHERE endpoint_hash=$1)',[sub.hash]);
    await tx(
     'INSERT INTO public.artae_push_subscriptions'+
     '(id,user_id,session_sid,endpoint,endpoint_hash,p256dh,auth_key,user_agent,created_at,updated_at) '+
     'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) '+
     'ON CONFLICT(endpoint_hash) DO UPDATE SET user_id=EXCLUDED.user_id,'+
     'session_sid=EXCLUDED.session_sid,endpoint=EXCLUDED.endpoint,p256dh=EXCLUDED.p256dh,'+
     'auth_key=EXCLUDED.auth_key,user_agent=EXCLUDED.user_agent,updated_at=EXCLUDED.updated_at',
     [randomUUID(),session.user.id,session.sid,sub.endpoint,sub.hash,sub.p256dh,sub.auth,
      String(req.headers.get('user-agent')||'').slice(0,160),Date.now()]);
   });
   return reply({ok:true});
  }
  if(body.action==='unsubscribe'){
   const endpoint=body.endpoint;
   if(typeof endpoint!=='string'||endpoint.length>2048)return reply({error:'Недопустимое устройство'},400);
   await query('DELETE FROM public.artae_push_subscriptions '+
    'WHERE endpoint_hash=$1 AND session_sid=$2 AND user_id=$3',
    [digest(endpoint),session.sid,session.user.id]);
   return reply({ok:true});
  }
  if(body.action==='test'){
   const sub=validSubscription(body.subscription);
   if(!sub)return reply({error:'Некорректная подписка'},400);
   const {rows:[record]}=await query('SELECT endpoint,p256dh,auth_key FROM public.artae_push_subscriptions '+
    'WHERE endpoint_hash=$1 AND session_sid=$2 AND user_id=$3',
    [sub.hash,session.sid,session.user.id]);
   if(!record)return reply({error:'Сначала включите уведомления'},404);
   const last=testTimes.get(session.sid)||0,now=Date.now();
   if(now-last<45000)return reply({error:'Повторите тест через 45 секунд'},429);
   if(testTimes.size>100)testTimes.clear();
   testTimes.set(session.sid,now);
   try{
    await sendWebPush({endpoint:record.endpoint,keys:{p256dh:record.p256dh,auth:record.auth_key}},
     {title:'АРТ-АЕ',body:'Проверка уведомлений',conversation:null});
    return reply({ok:true});
   }catch(error){
    const status=Number(error?.statusCode)||0;
    if(status===404||status===410){
     await query('DELETE FROM public.artae_push_subscriptions WHERE endpoint_hash=$1',[sub.hash]);
    }
    console.error('ART-AE push test: HTTP',status,error?.message);
    return reply({error:'Ошибка отправки Push (HTTP '+(status||'?')+')'},502);
   }
  }
  return reply({error:'Unknown action'},404);
 }catch(error){
  console.error('ART-AE push API:',error?.message||error);
  return reply({error:'Ошибка Push API'},502);
 }
}
