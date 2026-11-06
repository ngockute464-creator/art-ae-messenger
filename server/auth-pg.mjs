// ART-AE PostgreSQL authorization. Activate only after verified legacy migration.
// Cookie and existing access keys remain unchanged; no Yandex Disk requests.
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
const cookieName='__Host-artae_session',days180=180*86400000;
const hash=s=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const safeEqual=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y)};
const cookie=(value,seconds)=>cookieName+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+seconds;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(x,status=200,extra={})=>Response.json(x,{status,headers:{...headers,...extra}});
const userView=u=>({id:u.id,name:u.name,role:u.role,disabled:!!u.disabled});
const cleanName=s=>typeof s==='string'?s.trim().slice(0,80):'';
const sameOrigin=r=>{try{return new URL(r.headers.get('origin')).origin===new URL(r.url).origin}catch{return false}};
async function db(table,params={},method='GET',value){
 const root=process.env.SUPABASE_URL?.replace(/\/+$/,''),key=process.env.SUPABASE_SECRET_KEY;
 if(!root||!key)throw Error('Supabase storage not configured');
 const base=new URL(root);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.pathname!=='/')throw Error('Supabase URL invalid');
 const url=new URL(root+'/rest/v1/'+table);
 for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
 const h={apikey:key,Accept:'application/json'};
 if(method!=='GET'){h['Content-Type']='application/json';h.Prefer='return=representation'}
 const res=await fetch(url,{method,headers:h,body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(12000)});
 if(!res.ok){let err={};try{err=await res.json()}catch{}throw Object.assign(Error(err.message||'PostgREST '+res.status),{status:res.status,code:err.code})}
 return res.status===204?[]:res.json();
}
async function userById(id){
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return null;
 const rows=await db('artae_users',{id:'eq.'+id,select:'*',limit:'1'});return rows[0]||null;
}
async function getSession(request){
 const token=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 const sid=hash(token);
 // One indexed PostgreSQL request, including user via the session FK.
 const found=await db('artae_sessions',{sid:'eq.'+sid,select:'sid,user_id,generation,last_seen,created_at,artae_users(id,name,role,disabled,generation)',limit:'1'});
 const item=found[0],user=item?.artae_users;
 const last=Number(item?.last_seen);
 if(!item||!user||user.disabled||item.generation!==user.generation||!Number.isFinite(last)||Date.now()-last>days180||last-Date.now()>300000)return null;
 return {token,sid,item,user};
}
async function loginWithKey(key){
 if(!/^[A-Za-z0-9_-]{43}$/.test(key))return null;
 const digest=hash(key);
 const users=await db('artae_users',{key_hash:'eq.'+digest,disabled:'is.false',select:'*',limit:'1'});
 const user=users[0];if(!user||!safeEqual(user.key_hash,digest))return null;
 const token=secret(),sid=hash(token),now=Date.now();
 await db('artae_sessions',{},'POST',{sid,user_id:user.id,generation:user.generation,last_seen:now,created_at:now});
 return {token,user};
}
export default async function handler(request){
 const isGet=request.method==='GET';if(!isGet&&request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!isGet&&(!sameOrigin(request)||!request.headers.get('content-type')?.startsWith('application/json')))return reply({error:'Invalid origin or request'},403);
 try{
  const url=new URL(request.url),action=isGet?url.searchParams.get('action'):null;
  let body={};if(!isGet){try{body=await request.json()}catch{return reply({error:'Invalid JSON'},400)}}
  const method=action||body.action;
  if(method==='status'&&isGet){const users=await db('artae_users',{role:'eq.admin',select:'id',limit:'1'});return reply({initialized:users.length>0})}
  if(method==='bootstrap'&&!isGet){
   if(process.env.ARTAE_ALLOW_FRESH_BOOTSTRAP!=='1')
    return reply({error:'Первичная установка отключена'},409);
   const setup=process.env.ARTAE_SETUP_KEY;
   if(typeof setup!=='string'||setup.length<20||!safeEqual(body.setupKey,setup))
    return reply({error:'Неверный установочный ключ'},403);
   const existing=await db('artae_users',{select:'id',limit:'1'});
   if(existing.length)return reply({error:'Установка уже содержит пользователей'},409);
   const name=cleanName(body.name)||'Администратор',accessKey=secret();
   const admin={id:randomUUID(),name,role:'admin',key_hash:hash(accessKey),generation:1,disabled:false};
   try{
    const created=await db('artae_users',{},'POST',admin);
    if(created.length!==1)throw Error('Administrator creation not confirmed');
    return reply({ok:true,accessKey,user:userView(created[0])});
   }catch(error){
    if(error.code==='23505')return reply({error:'Администратор уже создан'},409);
    throw error;
   }
  }
  if(method==='login'&&!isGet){
   const login=await loginWithKey(String(body.accessKey||''));
   if(!login)return reply({error:'Неверный ключ доступа'},401);
   return reply({ok:true,user:userView(login.user)},200,{'Set-Cookie':cookie(login.token,180*86400)});
  }
  const session=await getSession(request);
  if(!session)return reply({error:'Требуется вход'},401,{'Set-Cookie':cookie('',0)});
  if(method==='me'&&isGet){
   const extra={},last=Number(session.item.last_seen);
   if(Date.now()-last>24*3600000){
    await db('artae_sessions',{sid:'eq.'+session.sid},'PATCH',{last_seen:Date.now()});
    extra['Set-Cookie']=cookie(session.token,180*86400);
   }
   return reply({ok:true,user:userView(session.user)},200,extra);
  }
  if(method==='logout'&&!isGet){
   await db('artae_sessions',{sid:'eq.'+session.sid},'DELETE');
   return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(session.user.role!=='admin')return reply({error:'Доступ только администратору'},403);
  if(method==='users'&&isGet){const users=await db('artae_users',{select:'*',order:'name.asc'});return reply({users:users.map(userView)})}
  if(method==='createUser'&&!isGet){
   const existing=await db('artae_users',{select:'id'});
   if(existing.length>=5)return reply({error:'Предел 5 пользователей для тестовой версии'},409);
   const name=cleanName(body.name);if(name.length<2)return reply({error:'Введите имя пользователя'},400);
   const accessKey=secret(),user={id:randomUUID(),name,role:'member',key_hash:hash(accessKey),generation:1,disabled:false};
   const created=await db('artae_users',{},'POST',user);
   return reply({ok:true,user:userView(created[0]),accessKey});
  }
  if(method==='reissueKey'&&!isGet){
   const user=await userById(body.userId);
   if(!user||user.role==='admin')return reply({error:'Пользователь не найден'},404);
   const accessKey=secret();
   const updated=await db('artae_users',{id:'eq.'+user.id},'PATCH',{key_hash:hash(accessKey),generation:user.generation+1});
   await db('artae_sessions',{user_id:'eq.'+user.id},'DELETE');
   return reply({ok:true,user:userView(updated[0]),accessKey});
  }
  if(method==='disableUser'&&!isGet){
   const user=await userById(body.userId);
   if(!user||user.role==='admin')return reply({error:'Пользователь не найден'},404);
   await db('artae_users',{id:'eq.'+user.id},'PATCH',{disabled:true,generation:user.generation+1});
   await db('artae_sessions',{user_id:'eq.'+user.id},'DELETE');
   return reply({ok:true});
  }
  return reply({error:'Unknown action'},404);
 }catch(err){console.error('ARTAE PostgreSQL auth:',err.status,err.code,err.message);return reply({error:'Временная ошибка сервера. Повторите попытку.'},502)}
}
export {getSession};
