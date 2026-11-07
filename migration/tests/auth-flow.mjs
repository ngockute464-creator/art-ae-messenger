// M2 integration test: bootstrap, key login, session, logout, cleanup.
// IMPORTANT: touches only the clean local artae DB; deletes the temporary fixture.
// Aborts unless users and sessions are empty. No secret ever printed.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import auth from '../runtime/auth.mjs';
import {assertLocalDatabase, query, closePool} from '../runtime/postgres.mjs';

const origin='http://127.0.0.1:3101';
const url=origin+'/.netlify/functions/auth';
const marker='M2_TEST_'+randomBytes(12).toString('hex');
const setupKey=randomBytes(32).toString('base64url');
let before,createdId=null,passed=false;

function requestPost(action, data={}, cookie) {
  return new Request(url, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      origin,
      ...(cookie?{cookie}:{})
    },
    body:JSON.stringify({action,...data})
  });
}
function requestGet(action,cookie) {
  return new Request(url+'?action='+encodeURIComponent(action),
    {headers:cookie?{cookie}:{}});
}
async function invoke(req,status) {
  const response=await auth(req);
  const payload=await response.json();
  assert.equal(response.status,status,req.method+' '+req.url+' returned '+response.status+': '+JSON.stringify(payload));
  return {response,payload};
}
async function counts() {
  const {rows:[r]}=await query(
    'SELECT (SELECT count(*)::int FROM public.artae_users) AS users,'+
    '(SELECT count(*)::int FROM public.artae_sessions) AS sessions'
  );
  return r;
}

try {
  await assertLocalDatabase();
  before=await counts();
  assert.deepEqual(before,{users:0,sessions:0},
    'DB contains existing accounts or sessions; refusing temporary bootstrap');
  process.env.ARTAE_ALLOW_FRESH_BOOTSTRAP='1';
  process.env.ARTAE_SETUP_KEY=setupKey;

  const bootstrap=await invoke(requestPost('bootstrap',{setupKey,name:marker}),200);
  assert.equal(bootstrap.payload.ok,true);
  assert.equal(bootstrap.payload.user.name,marker);
  createdId=bootstrap.payload.user.id;
  const accessKey=bootstrap.payload.accessKey;
  assert.match(accessKey,/^[A-Za-z0-9_-]{43}$/);
  await invoke(requestPost('login',{accessKey:'wrong'}),401);

  const login=await invoke(requestPost('login',{accessKey}),200);
  assert.equal(login.payload.user.id,createdId);
  const header=login.response.headers.get('set-cookie');
  assert.match(header,/^__Host-artae_session=[A-Za-z0-9_-]{43};/);
  assert.match(header,/; Secure; HttpOnly; SameSite=Strict;/);
  const cookie=header.split(';',1)[0];

  const me=await invoke(requestGet('me',cookie),200);
  assert.equal(me.payload.user.id,createdId);

  const users=await invoke(requestGet('users',cookie),200);
  assert.equal(users.payload.users.length,1);
  assert.equal(users.payload.users[0].id,createdId);

  const logout=await invoke(requestPost('logout',{},cookie),200);
  assert.equal(logout.payload.ok,true);
  await invoke(requestGet('me',cookie),401);
  passed=true;
} catch (err) {
  console.error('LOCAL_AUTH_FLOW_FAILED',err.stack||String(err));
  process.exitCode=1;
} finally {
  delete process.env.ARTAE_ALLOW_FRESH_BOOTSTRAP;
  delete process.env.ARTAE_SETUP_KEY;
  try {
    // Clean up only this unique test identity, never any existing identities.
    const result=await query(
      "DELETE FROM public.artae_users WHERE name=$1 AND role='admin' RETURNING id",
      [marker]
    );
    if (createdId!==null) assert.deepEqual(result.rows.map(x=>x.id),[createdId]);
    const after=await counts();
    assert.deepEqual(after,before ?? {users:0,sessions:0},'Fixture cleanup incomplete');
    if (passed) console.log('LOCAL_AUTH_FLOW_OK',JSON.stringify({
      bootstrap:true,login:true,session:true,logout:true,clean:true,
      users:after.users,sessions:after.sessions
    }));
  } catch (err) {
    console.error('LOCAL_AUTH_CLEANUP_FAILED',err.stack||String(err));
    process.exitCode=1;
  } finally {
    await closePool();
  }
}
