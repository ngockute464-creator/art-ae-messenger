// Shared avatars: identity, security, render plumbing and removal of stale local-only behavior.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const api=readFileSync('migration/runtime/avatars.mjs','utf8');
const app=readFileSync('public/app.js','utf8');
const client=readFileSync('server/avatars-client.js','utf8');
const patch=readFileSync('server/files-patch.mjs','utf8');
const route=readFileSync('migration/runtime/http-server.mjs','utf8');
const sql=readFileSync('migration/sql/008_shared_avatars.sql','utf8');
const deploy=readFileSync('migration/deploy/apply-shared-avatars.sh','utf8');
assert.ok(route.includes("['avatars',avatars]"));
assert.ok(patch.includes('messageAuthorAvatar(m)'),'Other authors use shared avatar lookup');
assert.ok(app.includes('messageAuthorAvatar(m)'),'Production bundle uses shared avatar lookup');
assert.ok(!app.includes('isMine(m)&&data.profile.avatar?'),'Old only-me render guard removed');
assert.ok(patch.includes('await saveOwnAvatar(m.avatar||null)'),'Profile saves on server');
assert.ok(client.includes("avatarsRequest('migrate'"),'Existing local photo is adopted once');
assert.ok(client.includes('AVATAR_ADOPTED_KEY'),'Old photo cannot resurrect after explicit removal');
assert.ok(client.includes('JSON.stringify([...sharedAvatars])!==before'),'No needless rerender');
assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS avatar text'));
assert.ok(sql.includes('CHECK(avatar IS NULL'));
assert.ok(deploy.includes('pg_dump --format=custom'));
assert.ok(deploy.includes('EXPECTED_SHA'));
assert.ok(!sql.includes('UPDATE public.artae_messages'));
assert.ok(!sql.includes('DELETE FROM public.artae_messages'));

const owner='11111111-1111-4111-8111-111111111111';
const peer='22222222-2222-4222-8222-222222222222';
const encoded='data:image/jpeg;base64,'+'a'.repeat(20);
const users=new Map([[owner,null],[peer,encoded]]);
let currentUser=owner;
const query=async(sql,params=[])=>{
 if(sql.startsWith('SELECT id,avatar FROM public.artae_users'))
  return {rows:[...users].map(([id,avatar])=>({id,avatar}))};
 if(sql.startsWith('UPDATE public.artae_users SET avatar=')){
  const [id,avatar]=params;
  if(sql.includes('avatar IS NULL')&&users.get(id)!==null)return {rows:[]};
  users.set(id,avatar);return {rows:[{avatar}]};
 }
 if(sql.startsWith('SELECT avatar FROM public.artae_users WHERE'))
  return {rows:users.has(params[0])?[{avatar:users.get(params[0])}]:[]};
 throw Error('Unexpected SQL '+sql);
};
const source=api.replace(/^import .*;$/gm,'').replace('export default async function handler','async function handler');
const handler=runInNewContext(source+'\nhandler',{
 query,getSession:async()=>({user:{id:currentUser}}),Response,URL,console,Date,Object,Error
});
const request=async(action,avatar,origin='https://artae.example')=>{
 const r=await handler(new Request('https://artae.example/.netlify/functions/avatars',{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({action,avatar})
 }));
 return {status:r.status,data:await r.json()};
};
let r=await request('migrate',encoded);
assert.equal(r.status,200);
assert.equal(users.get(owner),encoded,'Existing local owner photo is adopted');
r=await request('migrate','data:image/jpeg;base64,bbbb');
assert.equal(users.get(owner),encoded,'Migration must not overwrite a shared avatar');
r=await request('set',null);
assert.equal(r.status,200);
assert.equal(users.get(owner),null,'Owner can remove photo');
assert.equal(users.get(peer),encoded,'Other user photo cannot be modified');
r=await request('set','data:image/svg+xml;base64,PHN2Zz4=');
assert.equal(r.status,400,'Only safe JPEG accepted');
r=await request('set',encoded,'https://wrong.example');
assert.equal(r.status,403,'Cross-origin POST rejected');
const roster=await handler(new Request('https://artae.example/.netlify/functions/avatars'));
const result=await roster.json();
assert.equal(result.avatars.length,2);
assert.equal(result.avatars.find(x=>x.id===peer).avatar,encoded);
console.log('SHARED_AVATARS_OK owner_only=true roster=true safe_jpeg=true old_avatar_adoption=true');
