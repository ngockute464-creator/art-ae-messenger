// M2 read-only auth contract smoke test. Never bootstraps users or writes to DB.
import assert from 'node:assert/strict';
import handler, {getSession} from '../runtime/auth.mjs';
import {assertLocalDatabase,query,closePool} from '../runtime/postgres.mjs';

const base = 'http://127.0.0.1:3101/.netlify/functions/auth';
function post(action, extras = {}) {
  return new Request(base,{
    method:'POST',
    headers:{'Content-Type':'application/json','Origin':'http://127.0.0.1:3101'},
    body:JSON.stringify({action,...extras})
  });
}
async function checked(request, status, body = {}) {
  const response = await handler(request);
  assert.equal(response.status,status,request.method+' '+request.url);
  const json = await response.json();
  for (const [k,v] of Object.entries(body)) assert.deepEqual(json[k],v,k);
}

try {
  delete process.env.ARTAE_ALLOW_FRESH_BOOTSTRAP;
  await assertLocalDatabase();
  const before = await query('SELECT (SELECT count(*)::int FROM public.artae_users) AS users,(SELECT count(*)::int FROM public.artae_sessions) AS sessions');
  assert.deepEqual(before.rows[0],{users:0,sessions:0});
  await checked(new Request(base+'?action=status'),200,{initialized:false});
  await checked(new Request(base+'?action=me'),401,{error:'Требуется вход'});
  await checked(post('login',{accessKey:'invalid'}),401,{error:'Неверный ключ доступа'});
  await checked(post('bootstrap',{setupKey:'invalid'}),409,{error:'Первичная установка отключена'});
  assert.equal(await getSession(new Request(base+'?action=me')),null);
  const after = await query('SELECT (SELECT count(*)::int FROM public.artae_users) AS users,(SELECT count(*)::int FROM public.artae_sessions) AS sessions');
  assert.deepEqual(after.rows[0],before.rows[0]);
  console.log('LOCAL_AUTH_SMOKE_OK',JSON.stringify({status:200,me:401,login:401,bootstrap:409,writes:0}));
} catch (err) {
  console.error('LOCAL_AUTH_SMOKE_ERROR',err.stack||err);
  process.exitCode = 1;
} finally {
  await closePool();
}
