// Scoped JWT for private realtime channels. Uses the existing ART-AE session.
import {createHmac} from 'node:crypto';
import {getSession} from './auth.mjs';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const reply=(payload,status=200)=>Response.json(payload,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const base64url=part=>Buffer.from(JSON.stringify(part)).toString('base64url');
function signedJwt(payload,secret){
 const s=base64url({alg:'HS256',typ:'JWT'})+'.'+base64url(payload);
 return s+'.'+createHmac('sha256',secret).update(s).digest('base64url');
}
export default async function handler(req){
 if(req.method!=='GET')return reply({error:'Method not allowed'},405);
 try{
  const session=await getSession(req);
  if(!session)return reply({error:'Требуется вход'},401);
  const id=new URL(req.url).searchParams.get('convo');
  if(!UUID.test(id||''))return reply({error:'Invalid conversation'},400);
  const base=process.env.SUPABASE_URL?.replace(/\/+$/,'');
  const key=process.env.SUPABASE_SECRET_KEY;
  const publishable=process.env.SUPABASE_PUBLISHABLE_KEY;
  const signingKey=process.env.SUPABASE_JWT_SECRET;
  if(!base||!key||!publishable||!signingKey)return reply({enabled:false,error:'Realtime not configured'},503);
  const u=new URL(base);
  if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.pathname!=='/')return reply({error:'Invalid Supabase URL'},503);
  const query=new URL(base+'/rest/v1/artae_conversations');
  query.searchParams.set('id','eq.'+id);
  query.searchParams.set('deleted_at','is.null');
  query.searchParams.set('select','id,project_id');
  const res=await fetch(query,{headers:{apikey:key},signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Database lookup failed: '+res.status);
  const rows=await res.json();
  if(!rows.length)return reply({error:'Беседа не найдена'},404);
  // Current model: all enabled users have access to all projects.
  // Add explicit project membership checks before per-project ACLs are introduced.
  const now=Math.floor(Date.now()/1000),exp=now+600;
  const token=signedJwt({iss:'art-ae',aud:'authenticated',role:'authenticated',sub:session.user.id,iat:now,exp,artae:'1',artae_convo:id},signingKey);
  return reply({url:base,publishableKey:publishable,token,expiresAt:exp,topic:'artae:'+id});
 }catch(error){console.error('Realtime token issue',error?.message);return reply({error:'Realtime authorization failed'},502)}
}
