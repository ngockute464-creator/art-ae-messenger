// Admin-only test whether imported standby ES256 JWT is accepted by Supabase.
// No database mutations. Does not return JWTs, secrets, or data rows.
import {createPrivateKey,sign} from 'node:crypto';
import {getSession} from './auth.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const result=(data,status=200)=>Response.json(data,{status,headers});
const enc=ob=>Buffer.from(JSON.stringify(ob)).toString('base64url');
export default async function handler(req){
 if(req.method!=='GET')return result({ok:false,error:'Method not allowed'},405);
 try{
  const session=await getSession(req);
  if(!session)return result({ok:false,error:'Требуется вход'},401);
  if(session.user?.role!=='admin')return result({ok:false,error:'Только администратору'},403);
  const base=process.env.SUPABASE_URL?.replace(/\/+$/,'');
  const publishable=process.env.SUPABASE_PUBLISHABLE_KEY;
  const keyString=process.env.SUPABASE_SIGNING_JWK;
  if(!base||!publishable||!keyString)return result({ok:false,error:'Не заданы переменные Realtime'},503);
  const parsed=new URL(base);
  if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.supabase.co')||parsed.pathname!=='/')return result({ok:false,error:'Неправильный SUPABASE_URL'},503);
  const jwk=JSON.parse(keyString);
  if(jwk.kty!=='EC'||jwk.crv!=='P-256'||!jwk.kid||!jwk.d)return result({ok:false,error:'Некорректный ES256 JWK'},503);
  const now=Math.floor(Date.now()/1000);
  const input=enc({alg:'ES256',kid:jwk.kid,typ:'JWT'})+'.'+enc({iss:'art-ae',sub:session.user.id,role:'authenticated',aud:'authenticated',iat:now,exp:now+120});
  const token=input+'.'+sign('sha256',Buffer.from(input),{key:createPrivateKey({key:jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'}).toString('base64url');
  const url=new URL(base+'/rest/v1/artae_projects');
  url.searchParams.set('select','id');url.searchParams.set('limit','0');
  const response=await fetch(url,{headers:{apikey:publishable,Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  let responseError=null;
  if(!response.ok){try{const data=await response.json();responseError={code:data.code||null,message:String(data.message||'').slice(0,250)}}catch{responseError={message:'HTTP '+response.status}}}
  return result({ok:response.ok,accepted:response.ok,upstreamStatus:response.status,jwkKid:jwk.kid,error:responseError,notes:'Проверен только JWT на Data API; частный Realtime-канал отдельно не проверялся.'});
 }catch(error){console.error('JWT standby probe',error.message);return result({ok:false,error:'Ошибка проверки JWT',detail:String(error.message).slice(0,150)},502)}
}
