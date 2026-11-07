// ART-AE local authorization adapter. Separate from the production server.
// API-compatible with server/auth-pg.mjs, but uses SQL on local PostgreSQL.
import {randomBytes, randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import {query, transaction} from './postgres.mjs';

const cookieName = '__Host-artae_session';
const days180 = 180 * 86400000;
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};
const cookie = (value, seconds) => cookieName+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+seconds;
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply = (data, status = 200, extra = {}) => Response.json(data, {status, headers:{...headers,...extra}});
const userView = user => ({id:user.id,name:user.name,role:user.role,disabled:!!user.disabled});
const cleanName = value => typeof value === 'string' ? value.trim().slice(0,80) : '';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const sameOrigin = request => {
  try { return new URL(request.headers.get('origin')).origin === new URL(request.url).origin; }
  catch { return false; }
};
const userFields = 'id,name,role,key_hash,generation,disabled';

async function userById(id) {
  if (!uuid(id)) return null;
  const {rows:[user]} = await query('SELECT '+userFields+' FROM public.artae_users WHERE id=$1', [id]);
  return user ?? null;
}

export async function getSession(request) {
  const token = (request.headers.get('cookie') ?? '').split(';').map(x=>x.trim())
    .find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const sid = hash(token);
  const {rows:[r]} = await query(
    'SELECT s.sid,s.generation AS session_generation,s.last_seen,s.created_at,'+
    'u.id,u.name,u.role,u.disabled,u.generation AS user_generation '+
    'FROM public.artae_sessions s JOIN public.artae_users u ON u.id=s.user_id WHERE s.sid=$1',
    [sid]
  );
  if (!r) return null;
  const last = Number(r.last_seen);
  const now = Date.now();
  if (r.disabled || r.session_generation !== r.user_generation ||
      !Number.isSafeInteger(last) || now-last > days180 || last-now > 300000) return null;
  return {
    token, sid,
    item:{sid:r.sid,generation:r.session_generation,last_seen:r.last_seen,created_at:r.created_at},
    user:{id:r.id,name:r.name,role:r.role,disabled:r.disabled,generation:r.user_generation}
  };
}

async function loginWithKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  const digest = hash(key);
  const {rows:[user]} = await query(
    'SELECT '+userFields+' FROM public.artae_users WHERE key_hash=$1 AND disabled=false', [digest]
  );
  if (!user || !safeEqual(user.key_hash,digest)) return null;
  const token = secret(), now = Date.now();
  await query(
    'INSERT INTO public.artae_sessions(sid,user_id,generation,last_seen,created_at) VALUES($1,$2,$3,$4,$4)',
    [hash(token),user.id,user.generation,now]
  );
  return {token,user};
}

export default async function handler(request) {
  const isGet = request.method === 'GET';
  if (!isGet && request.method !== 'POST') return reply({error:'Method not allowed'},405);
  if (!isGet && (!sameOrigin(request) ||
      !request.headers.get('content-type')?.startsWith('application/json'))) {
    return reply({error:'Invalid origin or request'},403);
  }
  try {
    const url = new URL(request.url);
    let body = {};
    if (!isGet) {
      try { body = await request.json(); } catch { return reply({error:'Invalid JSON'},400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Invalid JSON'},400);
    }
    const method = (isGet ? url.searchParams.get('action') : body.action);
    if (method === 'status' && isGet) {
      const {rows:[r]} = await query("SELECT EXISTS(SELECT 1 FROM public.artae_users WHERE role='admin') AS initialized");
      return reply({initialized:r.initialized});
    }
    if (method === 'bootstrap' && !isGet) {
      if (process.env.ARTAE_ALLOW_FRESH_BOOTSTRAP !== '1') return reply({error:'Первичная установка отключена'},409);
      const setup = process.env.ARTAE_SETUP_KEY;
      if (typeof setup !== 'string' || setup.length < 20 || !safeEqual(body.setupKey,setup))
        return reply({error:'Неверный установочный ключ'},403);
      const name = cleanName(body.name) || 'Администратор';
      const accessKey = secret();
      try {
        const user = await transaction(async tx => {
          await tx('SELECT pg_advisory_xact_lock(20261107,1)');
          const {rows:[count]} = await tx('SELECT count(*)::int AS n FROM public.artae_users');
          if (count.n > 0) return null;
          const {rows:[created]} = await tx(
            'INSERT INTO public.artae_users(id,name,role,key_hash,generation,disabled) '+
            "VALUES($1,$2,'admin',$3,1,false) RETURNING "+userFields,
            [randomUUID(),name,hash(accessKey)]
          );
          return created;
        });
        if (!user) return reply({error:'Установка уже содержит пользователей'},409);
        return reply({ok:true,accessKey,user:userView(user)});
      } catch (error) {
        if (error.code === '23505') return reply({error:'Администратор уже создан'},409);
        throw error;
      }
    }
    if (method === 'login' && !isGet) {
      const result = await loginWithKey(body.accessKey);
      if (!result) return reply({error:'Неверный ключ доступа'},401);
      return reply({ok:true,user:userView(result.user)},200,{'Set-Cookie':cookie(result.token,180*86400)});
    }
    const session = await getSession(request);
    if (!session) return reply({error:'Требуется вход'},401,{'Set-Cookie':cookie('',0)});
    if (method === 'me' && isGet) {
      const extra = {};
      const last = Number(session.item.last_seen);
      if (Date.now()-last > 24*3600000) {
        await query('UPDATE public.artae_sessions SET last_seen=$1 WHERE sid=$2',[Date.now(),session.sid]);
        extra['Set-Cookie'] = cookie(session.token,180*86400);
      }
      return reply({ok:true,user:userView(session.user)},200,extra);
    }
    if (method === 'logout' && !isGet) {
      await query('DELETE FROM public.artae_sessions WHERE sid=$1',[session.sid]);
      return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
    }
    if (session.user.role !== 'admin') return reply({error:'Доступ только администратору'},403);
    if (method === 'users' && isGet) {
      const {rows} = await query('SELECT '+userFields+' FROM public.artae_users ORDER BY name ASC');
      return reply({users:rows.map(userView)});
    }
    if (method === 'createUser' && !isGet) {
      const name = cleanName(body.name);
      if (name.length < 2) return reply({error:'Введите имя пользователя'},400);
      const accessKey = secret();
      const created = await transaction(async tx => {
        await tx('SELECT pg_advisory_xact_lock(20261107,1)');
        const {rows:[count]} = await tx('SELECT count(*)::int AS n FROM public.artae_users');
        if (count.n >= 5) return null;
        const {rows:[user]} = await tx(
          'INSERT INTO public.artae_users(id,name,role,key_hash,generation,disabled) '+
          "VALUES($1,$2,'member',$3,1,false) RETURNING "+userFields,
          [randomUUID(),name,hash(accessKey)]
        );
        return user;
      });
      if (!created) return reply({error:'Предел 5 пользователей для тестовой версии'},409);
      return reply({ok:true,user:userView(created),accessKey});
    }
    if (method === 'reissueKey' && !isGet) {
      if (!uuid(body.userId)) return reply({error:'Пользователь не найден'},404);
      const accessKey = secret();
      const changed = await transaction(async tx => {
        const {rows:[user]} = await tx(
          'UPDATE public.artae_users SET key_hash=$1,generation=generation+1 '+
          "WHERE id=$2 AND role<>'admin' RETURNING "+userFields,
          [hash(accessKey),body.userId]
        );
        if (!user) return null;
        await tx('DELETE FROM public.artae_sessions WHERE user_id=$1',[user.id]);
        return user;
      });
      if (!changed) return reply({error:'Пользователь не найден'},404);
      return reply({ok:true,user:userView(changed),accessKey});
    }
    if (method === 'disableUser' && !isGet) {
      if (!uuid(body.userId)) return reply({error:'Пользователь не найден'},404);
      const changed = await transaction(async tx => {
        const {rows:[user]} = await tx(
          'UPDATE public.artae_users SET disabled=true,generation=generation+1 '+
          "WHERE id=$1 AND role<>'admin' RETURNING id",
          [body.userId]
        );
        if (!user) return false;
        await tx('DELETE FROM public.artae_sessions WHERE user_id=$1',[user.id]);
        return true;
      });
      if (!changed) return reply({error:'Пользователь не найден'},404);
      return reply({ok:true});
    }
    return reply({error:'Unknown action'},404);
  } catch (error) {
    console.error('ARTAE local auth:',error.code,error.message);
    return reply({error:'Временная ошибка сервера. Повторите попытку.'},502);
  }
}
