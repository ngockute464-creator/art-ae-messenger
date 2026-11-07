// M2 integration test: local sync contract with temporary DB fixtures.
// Refuses to run if any real app data exists. Never accesses Yandex Disk.
// Temporary records are removed in finally even after failed assertions.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import sync from '../runtime/sync.mjs';
import {assertLocalDatabase,query,transaction,closePool} from '../runtime/postgres.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const origin='http://127.0.0.1:3101';
const base=origin+'/.netlify/functions/sync';
const userId=randomUUID(),projectId=randomUUID(),convoId=randomUUID();
const marker='M2_SYNC_'+randomBytes(10).toString('hex');
const token=randomBytes(32).toString('base64url');
const cookie='__Host-artae_session='+token;
const headers={cookie};
let before=null,prepared=false,success=false;

const get=(action,params={})=>{
  const u=new URL(base);
  u.searchParams.set('action',action);
  for(const [k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  return new Request(u,{headers});
};
const post=(action,values={},useCookie=true)=>new Request(base,{
  method:'POST',
  headers:{'Content-Type':'application/json',Origin:origin,...(useCookie?headers:{})},
  body:JSON.stringify({action,...values})
});
async function call(req,status) {
  const r=await sync(req), data=await r.json();
  assert.equal(r.status,status,req.url+' -> '+JSON.stringify(data));
  return data;
}
async function counts() {
  const {rows:[r]}=await query(
    'SELECT '+
    '(SELECT count(*)::int FROM artae_users) AS users,'+
    '(SELECT count(*)::int FROM artae_sessions) AS sessions,'+
    '(SELECT count(*)::int FROM artae_projects) AS projects,'+
    '(SELECT count(*)::int FROM artae_conversations) AS convos,'+
    '(SELECT count(*)::int FROM artae_messages) AS messages,'+
    '(SELECT count(*)::int FROM artae_pins) AS pins,'+
    '(SELECT count(*)::int FROM artae_office_locks) AS locks'
  );
  return r;
}

try {
  await assertLocalDatabase();
  before=await counts();
  assert.ok(Object.values(before).every(v=>v===0),'Nonempty database: refusing fixture');
  await query(
    "INSERT INTO artae_users(id,name,role,key_hash,generation,disabled) VALUES($1,$2,'admin',$3,1,false)",
    [userId,marker,hash(randomBytes(32).toString('base64url'))]
  );
  await query(
    'INSERT INTO artae_sessions(sid,user_id,generation,last_seen,created_at) VALUES($1,$2,1,$3,$3)',
    [hash(token),userId,Date.now()]
  );
  await query(
    'INSERT INTO artae_projects(id,name,folder_path,created_by,created_at) VALUES($1,$2,$3,$4,$5)',
    [projectId,marker,'app:/'+marker,userId,Date.now()]
  );
  await query(
    'INSERT INTO artae_conversations(id,project_id,name,created_at) VALUES($1,$2,$3,$4)',
    [convoId,projectId,'Temporary conversation',Date.now()]
  );
  prepared=true;

  const noAuth=await sync(new Request(base+'?action=overview'));
  assert.equal(noAuth.status,401);
  const overview=await call(get('overview'),200);
  assert.equal(overview.projects.length,1);
  assert.equal(overview.convos.length,1);
  assert.equal(overview.projects[0].folderPath,'app:/'+marker);
  const guarded=await call(post('createProject',{name:'Must-not-create-folder'}),503);
  assert.match(guarded.error,/папок/);
  const created=await call(post('createConvo',{project:projectId,name:'New chat'}),200);
  assert.match(created.convo.id,/^[a-f0-9-]{36}$/);
  assert.equal(created.convo.project,projectId);
  const updated=await call(post('updateConvo',{id:created.convo.id,name:'Renamed chat'}),200);
  assert.equal(updated.convo.name,'Renamed chat');

  const messageId=randomUUID();
  const first=await call(post('send',{convo:convoId,text:'Initial message',requestId:messageId}),200);
  assert.equal(first.message.id,messageId);
  assert.equal(first.message.who,marker);
  const repeated=await call(post('send',{convo:convoId,text:'Initial message',requestId:messageId}),200);
  assert.equal(repeated.repeated,true);
  await call(post('send',{convo:convoId,text:'Different content',requestId:messageId}),409);

  const list=await call(get('messages',{convo:convoId,since:0,paging:1}),200);
  assert.equal(list.messages.length,1);
  assert.equal(list.messages[0].text,'Initial message');
  assert.equal(list.initial,true);
  assert.equal(list.hasMore,false);

  const edited=await call(post('edit',{id:messageId,convo:convoId,expectedEditedAt:null,text:'Edited message'}),200);
  assert.equal(edited.message.text,'Edited message');
  assert.ok(Number.isSafeInteger(edited.message.editedAt));
  await call(post('edit',{id:messageId,convo:convoId,expectedEditedAt:null,text:'Stale edit'}),409);
  const deleted=await call(post('delete',{id:messageId,convo:convoId,expectedEditedAt:edited.message.editedAt}),200);
  assert.ok(Number.isSafeInteger(deleted.message.deletedAt));
  await call(post('delete',{id:messageId,convo:convoId,expectedEditedAt:edited.message.editedAt}),404);
  const listAfter=await call(get('messages',{convo:convoId,since:0}),200);
  assert.equal(listAfter.messages.length,1);
  assert.equal(listAfter.messages[0].text,'Edited message');
  assert.equal(listAfter.messages[0].deletedAt,deleted.message.deletedAt);

  await call(post('deleteProject',{id:projectId,confirmName:marker}),200);
  assert.equal((await call(get('overview'),200)).projects.length,0);
  assert.equal((await call(get('deletedProjects'),200)).projects.length,1);
  const restored=await call(post('restoreProject',{id:projectId}),200);
  assert.equal(restored.project.id,projectId);
  assert.equal((await call(get('overview'),200)).projects.length,1);
  success=true;
} catch(error) {
  console.error('LOCAL_SYNC_FLOW_FAILED',error.stack||String(error));
  process.exitCode=1;
} finally {
  try {
    if(before!==null) {
      await transaction(async tx=>{
        await tx('DELETE FROM artae_messages WHERE conversation_id IN (SELECT id FROM artae_conversations WHERE project_id=$1)',[projectId]);
        await tx('DELETE FROM artae_conversations WHERE project_id=$1',[projectId]);
        await tx('DELETE FROM artae_projects WHERE id=$1',[projectId]);
        await tx('DELETE FROM artae_users WHERE id=$1 AND name=$2',[userId,marker]);
      });
      const after=await counts();
      assert.deepEqual(after,before,'Fixture cleanup incomplete');
      if(success)console.log('LOCAL_SYNC_FLOW_OK',JSON.stringify({
        overview:true,convos:true,idempotentSend:true,editCas:true,
        deleteCas:true,softDeleteRestore:true,diskGuard:true,clean:true
      }));
    }
  } catch(error) {
    console.error('LOCAL_SYNC_CLEANUP_FAILED',error.stack||String(error));
    process.exitCode=1;
  } finally {
    await closePool();
  }
}
