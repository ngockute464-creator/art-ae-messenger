// Authenticated roster and self-only avatar update. PostgreSQL is authoritative.
import {getSession} from './auth.mjs';
import {query} from './postgres.mjs';
import {createHash} from 'node:crypto';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>Response.json(data,{status,headers});
const sameOrigin=req=>{try{return new URL(req.headers.get('origin')).origin===new URL(req.url).origin}catch{return false}};
const avatarOk=x=>x===null||(typeof x==='string'&&x.length<=80000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x));
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return reply({error:'Method not allowed'},405);
 if(req.method==='POST'&&(!sameOrigin(req)||!req.headers.get('content-type')?.startsWith('application/json')))
  return reply({error:'Недопустимый запрос'},403);
 try{
  const session=await getSession(req);
  if(!session)return reply({error:'Требуется вход'},401);
  if(req.method==='GET'){
   const {rows}=await query('SELECT id,avatar FROM public.artae_users WHERE disabled=false ORDER BY id');
   const avatars=rows.map(row=>({id:row.id,avatar:row.avatar||null}));
   const etag='"'+createHash('sha256').update(JSON.stringify(avatars)).digest('hex')+'"';
   if(req.headers.get('if-none-match')===etag)
    return new Response(null,{status:304,headers:{...headers,ETag:etag}});
   return Response.json({avatars},{headers:{...headers,ETag:etag}});
  }
  let body;try{body=await req.json()}catch{return reply({error:'Неправильный JSON'},400)}
  if(!body||typeof body!=='object'||Array.isArray(body)||!avatarOk(body.avatar)||!Object.hasOwn(body,'avatar'))
   return reply({error:'Недопустимый аватар'},400);
  if(body.action!=='set')return reply({error:'Неизвестная операция'},404);
  const {rows:[changed]}=await query(
   'UPDATE public.artae_users SET avatar=$2 WHERE id=$1 RETURNING avatar',
   [session.user.id,body.avatar]);
  if(changed)return reply({ok:true,avatar:changed.avatar});
  const {rows:[existing]}=await query('SELECT avatar FROM public.artae_users WHERE id=$1',[session.user.id]);
  if(!existing)return reply({error:'Пользователь не найден'},404);
  return reply({ok:true,avatar:existing.avatar||null});
 }catch(error){
  console.error('ARTAE avatars:',error.code,error.message);
  return reply({error:'Не удалось синхронизировать аватар'},503);
 }
}
