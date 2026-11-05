// Read-only comparison of current Yandex and PostgreSQL authentication.
import {getSession as getDiskSession} from './auth-disk.mjs';
import {getSession as getPgSession} from './auth-pg.mjs';
const reply=(payload,status=200)=>Response.json(payload,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default async function handler(req){
 if(req.method!=='GET')return reply({ok:false,error:'Method not allowed'},405);
 try{
  const legacy=await getDiskSession(req);
  if(!legacy)return reply({ok:false,error:'Требуется действующий вход'},401);
  if(legacy.user.role!=='admin')return reply({ok:false,error:'Только администратору'},403);
  const modern=await getPgSession(req);
  const compare={
   sameUser:!!modern&&modern.user.id===legacy.user.id,
   sameRole:!!modern&&modern.user.role===legacy.user.role,
   sameSession:!!modern&&modern.sid===legacy.sid,
   sameGeneration:!!modern&&modern.item.generation===legacy.item.generation,
   modernSessionFound:!!modern
  };
  return reply({ok:Object.values(compare).every(Boolean),checks:compare,
   note:'Только чтение. Авторизация приложения по-прежнему использует прежнее хранилище.'});
 }catch(error){console.error('ARTAE auth comparison:',error?.message);return reply({ok:false,error:'Ошибка проверки совместимости',detail:String(error?.message||'').slice(0,140)},502)}
}
