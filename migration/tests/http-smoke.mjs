// ART-AE M2 real HTTP smoke test. Starts and stops isolated :3101 server.
// Requires empty local database, makes NO writes, never touches production.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {assertLocalDatabase,query,closePool} from '../runtime/postgres.mjs';

const origin='http://127.0.0.1:3101';
const serverPath=new URL('../runtime/http-server.mjs',import.meta.url).pathname;
let child=null,finished=false;
async function counts(){
  const {rows:[r]}=await query(
    'SELECT (SELECT count(*)::int FROM artae_users) AS users,'+
    '(SELECT count(*)::int FROM artae_sessions) AS sessions,'+
    '(SELECT count(*)::int FROM artae_projects) AS projects,'+
    '(SELECT count(*)::int FROM artae_conversations) AS conversations,'+
    '(SELECT count(*)::int FROM artae_messages) AS messages'
  );
  return r;
}
async function check(path,expected,opts={}){
  const response=await fetch(origin+path,{...opts,signal:AbortSignal.timeout(3000)});
  const data=await response.json();
  assert.equal(response.status,expected,path+' returned '+response.status+': '+JSON.stringify(data));
  return data;
}
try{
  await assertLocalDatabase();
  const baseline=await counts();
  assert.ok(Object.values(baseline).every(v=>v===0),'Database not empty; refusing HTTP smoke test');

  let logs='';
  child=spawn(process.execPath,[serverPath],{stdio:['ignore','pipe','pipe'],env:{...process.env,ARTAE_ALLOW_FRESH_BOOTSTRAP:'0'}});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data',data=>{logs+=data});
  child.stderr.on('data',data=>{logs+=data});

  for(let i=0;i<50&&!logs.includes('ARTAE_NEXT_LISTENING');i++){
    if(child.exitCode!==null)throw Error('Server exited unexpectedly: '+logs);
    await sleep(100);
  }
  assert.match(logs,/ARTAE_NEXT_LISTENING 127\.0\.0\.1:3101/,'Server did not start: '+logs);

  assert.equal((await check('/healthz',200)).ok,true);
  assert.equal((await check('/.netlify/functions/auth?action=status',200)).initialized,false);
  assert.equal((await check('/.netlify/functions/auth?action=me',401)).error,'Требуется вход');
  await check('/.netlify/functions/sync?action=overview',401);
  await check('/.netlify/functions/auth',401,{
    method:'POST',
    headers:{Origin:origin,'content-type':'application/json'},
    body:JSON.stringify({action:'login',accessKey:'invalid'})
  });
  await check('/.netlify/functions/auth',409,{
    method:'POST',
    headers:{Origin:origin,'content-type':'application/json'},
    body:JSON.stringify({action:'bootstrap',setupKey:'invalid'})
  });
  await check('/.netlify/functions/not-migrated',404);
  const after=await counts();
  assert.deepEqual(after,baseline,'HTTP requests unexpectedly changed database');
  finished=true;
  console.log('LOCAL_HTTP_SMOKE_OK',JSON.stringify({
    port:3101,health:true,authStatus:true,authGuard:true,syncGuard:true,noWrites:true
  }));
}catch(err){
  console.error('LOCAL_HTTP_SMOKE_FAILED',err.stack||String(err));
  process.exitCode=1;
}finally{
  if(child&&!child.killed){
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve=>child.once('exit',resolve)),
      sleep(2500)
    ]);
    if(child.exitCode===null)child.kill('SIGKILL');
  }
  await closePool();
}
