// Stage 1: admin-only, one-time import from Yandex app folder into PostgreSQL.
// This endpoint never modifies Yandex Disk or swaps the live authentication module.
import {getSession} from './auth-disk.mjs';
const API='https://cloud-api.yandex.net/v1/disk',root='app:/_system';
const reply=(obj,status=200)=>Response.json(obj,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const originOk=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const validUUID=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const validHash=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const validateUrl=url=>{const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.pathname!=='/')throw Error('Invalid database URL');return u.origin};
function env(){
 if(!process.env.YANDEX_DISK_TOKEN||!process.env.SUPABASE_SECRET_KEY||!process.env.SUPABASE_URL)throw Error('Storage not configured');
 return {base:validateUrl(process.env.SUPABASE_URL),key:process.env.SUPABASE_SECRET_KEY};
}
async function disk(path){
 const r=await fetch(API+path,{headers:{Authorization:'OAuth '+process.env.YANDEX_DISK_TOKEN},signal:AbortSignal.timeout(14000)});
 if(!r.ok)throw Error('Disk API '+r.status);return r.json();
}
function safeHref(href){
 const u=new URL(href);if(u.protocol!=='https:'||!(u.hostname==='yandex.ru'||u.hostname.endsWith('.yandex.ru')||u.hostname.endsWith('.yandex.net')||u.hostname.endsWith('.yandex.com')))throw Error('Unexpected transfer URL');return u.toString();
}
async function load(path){
 const url=await disk('/resources/download?'+new URLSearchParams({path}));
 const r=await fetch(safeHref(url.href),{signal:AbortSignal.timeout(14000)});
 if(!r.ok)throw Error('Disk download '+r.status);return r.json();
}
async function sessionsList(){
 let offset=0;const results=[];
 for(let page=0;page<100;page++){
  const list=await disk('/resources?'+new URLSearchParams({path:root+'/sessions',limit:'100',offset:String(offset)}));
  const set=list._embedded?.items||[];results.push(...set);offset+=set.length;
  if(offset>=Number(list._embedded?.total||0))break;
 }
 return results.filter(s=>s.type==='file'&&/^[0-9a-f]{64}\.json$/.test(s.name)).map(s=>s.path);
}
async function pg(table,method='GET',query={},data){
 const {base,key}=env(),url=new URL(base+'/rest/v1/'+table);
 for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
 const headers={apikey:key,Accept:'application/json'};
 if(method!=='GET'){headers['Content-Type']='application/json';headers.Prefer='resolution=merge-duplicates,return=representation'}
 const r=await fetch(url,{method,headers,body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(14000)});
 if(!r.ok){let err={};try{err=await r.json()}catch{}throw Error('PostgreSQL '+r.status+': '+String(err.message||err.code||'Unknown').slice(0,120))}
 return r.status===204?[]:r.json();
}
export default async function handler(request){
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 if(!originOk(request)||!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'Invalid origin'},403);
 try{
  const session=await getSession(request);
  if(!session)return reply({error:'Требуется вход'},401);
  if(session.user.role!=='admin')return reply({error:'Только администратору'},403);
  const body=await request.json();
  if(body.action!=='migrate'||body.confirm!=='MIGRATE_USERS_ONLY')return reply({error:'Confirmation required'},400);
  const source=await load(root+'/users.json');
  if(!Array.isArray(source?.users)||!source.users.some(u=>u.id===session.user.id&&u.role==='admin'))throw Error('Invalid source accounts');
  const users=source.users.map(u=>({id:u.id,name:u.name,role:u.role,key_hash:u.keyHash,generation:u.generation,disabled:!!u.disabled}));
  if(users.some(u=>!validUUID(u.id)||typeof u.name!=='string'||!['admin','member'].includes(u.role)||!validHash(u.key_hash)||!Number.isInteger(u.generation)||u.generation<1))throw Error('Invalid source user data');
  const paths=await sessionsList();
  const sessions=[];
  for(const path of paths){
   const s=await load(path);
   if(!validHash(s.sid)||s.sid+'.json'!==path.split('/').pop()||!validUUID(s.userId)||!Number.isFinite(s.lastSeen)||!Number.isFinite(s.createdAt)||!Number.isInteger(s.generation))throw Error('Invalid source session');
   sessions.push({sid:s.sid,user_id:s.userId,generation:s.generation,last_seen:s.lastSeen,created_at:s.createdAt});
  }
  if(!sessions.some(s=>s.sid===session.sid))throw Error('Administrator session missing');
  if(sessions.some(s=>!users.some(u=>u.id===s.user_id)))throw Error('Session references unknown user');
  const existing=await pg('artae_users','GET',{select:'id',limit:'100'});
  if(existing.length)return reply({ok:false,error:'PostgreSQL accounts already exist; refusing to overwrite',existingUsers:existing.length},409);
  const inserted=await pg('artae_users','POST',{on_conflict:'id'},users);
  if(sessions.length)await pg('artae_sessions','POST',{on_conflict:'sid'},sessions);
  const postUsers=await pg('artae_users','GET',{select:'id',limit:'100'});
  const postSessions=await pg('artae_sessions','GET',{select:'sid',limit:'1000'});
  const match=users.length===postUsers.length&&sessions.length===postSessions.length&&users.every(u=>postUsers.some(p=>p.id===u.id))&&sessions.every(s=>postSessions.some(p=>p.sid===s.sid));
  return reply({ok:match,sourceUsers:users.length,importedUsers:postUsers.length,sourceSessions:sessions.length,importedSessions:postSessions.length,legacyUntouched:true},match?200:409);
 }catch(e){console.error('ARTAE account migration:',e.message);return reply({ok:false,error:'Миграция не завершена; старое хранилище не изменено',detail:String(e.message).slice(0,150)},502)}
}