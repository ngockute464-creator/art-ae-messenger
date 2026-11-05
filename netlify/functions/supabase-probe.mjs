// Read-only Supabase connectivity check, admin only. No changes to live storage.
import { getSession } from './auth.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(body,status=200)=>Response.json(body,{status,headers});
export default async function handler(request){
  if(request.method!=='GET')return reply({ok:false,error:'Method not allowed'},405);
  try{
    const session=await getSession(request);
    if(!session)return reply({ok:false,error:'Требуется вход'},401);
    if(session.user.role!=='admin')return reply({ok:false,error:'Только администратору'},403);
    const root=process.env.SUPABASE_URL?.replace(/\/+$/,'');
    const key=process.env.SUPABASE_SECRET_KEY;
    if(!root||!key)return reply({ok:false,error:'Нет переменных SUPABASE_URL или SUPABASE_SECRET_KEY'},503);
    const url=new URL(root);
    if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co'))return reply({ok:false,error:'Некорректный адрес Supabase'},503);
    const checks={};
    for(const table of ['artae_projects','artae_conversations','artae_messages']){
      const res=await fetch(`${root}/rest/v1/${table}?select=id&limit=1`,{
        headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(10000)
      });
      if(!res.ok){
        let error='';try{const data=await res.json();error=String(data.message||data.code||'')}catch{}
        return reply({ok:false,table,status:res.status,error:error.slice(0,200)||'Supabase REST error'},502);
      }
      const value=await res.json();
      if(!Array.isArray(value))return reply({ok:false,table,error:'Unexpected response'},502);
      checks[table]='read_ok';
    }
    return reply({ok:true,checks,message:'Supabase: чтение трёх таблиц работает. Запись не проверялась.'});
  }catch(err){console.error('Supabase probe:',err?.message);return reply({ok:false,error:'Ошибка проверки подключения Supabase',detail:String(err?.message||'').slice(0,160)},502)}
}
