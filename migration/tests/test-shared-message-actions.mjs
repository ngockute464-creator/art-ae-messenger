import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('migration/runtime/sync.mjs','utf8');
const app=readFileSync('public/app.js','utf8');
const actions=readFileSync('server/shared-message-actions.js','utf8');
const menu=readFileSync('server/message-menu-client.js','utf8');
const sql=readFileSync('migration/sql/009_shared_message_edits.sql','utf8');
const script=readFileSync('migration/deploy/apply-shared-message-edits.sh','utf8');
const author='11111111-1111-4111-8111-111111111111';
const peer='22222222-2222-4222-8222-222222222222';
const conversation='33333333-3333-4333-8333-333333333333';
const project='44444444-4444-4444-8444-444444444444';
const id='55555555-5555-4555-8555-555555555555';
const message={id,conversation_id:conversation,author_id:author,author_name:'Автор',
 body:'Оригинальный текст',created_at:1700000000000,edited_at:null,deleted_at:null,edited_by:null,edited_by_name:null};
let current=peer,updates=0;
async function query(sql,params=[]){
 if(sql.startsWith('SELECT * FROM public.artae_messages WHERE id='))return {rows:params[0]===id?[{...message}]:[]};
 if(sql.startsWith('SELECT * FROM public.artae_conversations WHERE id='))return {rows:params[0]===conversation?[{id:conversation,project_id:project,deleted_at:null}]:[]};
 if(sql.startsWith('SELECT * FROM public.artae_projects WHERE id='))return {rows:params[0]===project?[{id:project,deleted_at:null}]:[]};
 if(sql.startsWith('UPDATE public.artae_messages SET body=$3')){
  assert.equal(params[0],id);
  assert.equal(params[1],conversation);
  assert.equal(params[6],message.edited_at,'Optimistic revision must be checked');
  if(message.deleted_at!==null)return {rows:[]};
  message.body=params[2];message.edited_at=params[3];message.edited_by=params[4];message.edited_by_name=params[5];
  updates++;return {rows:[{...message}]};
 }
 if(sql.startsWith("UPDATE public.artae_messages SET body=''")){
  assert.equal(params[2],author,'Deleted message must still belong to requester');
  if(message.author_id!==params[2]||message.edited_at!==params[4])return {rows:[]};
  message.body='';message.deleted_at=params[3];
  return {rows:[{...message}]};
 }
 throw Error('Unexpected SQL: '+sql);
}
const adapted=source.replace(/^import .*;$/gm,'').replace('export default async function handler','async function handler');
const handler=runInNewContext(adapted+'\nhandler',{
 query,transaction:async fn=>fn(query),
 getSession:async()=>({user:{id:current,name:current===author?'Автор':'Другой участник',role:'user'}}),
 messageStats:async()=>[],markMessagesRead:async()=>({}),
 renameProjectFolder:async()=>{},folderForName:()=>'',extractChatAttachmentRefs:()=>[],pumpChatAttachmentCleanup:()=>{},
 randomUUID:()=>id,Response,URL,Buffer,AbortSignal,Date,Math,Number,Object,String,console,
});
async function call(action,body,origin='https://artae.example'){
 const response=await handler(new Request('https://artae.example/.netlify/functions/sync',{
  method:'POST',headers:{origin,'content-type':'application/json'},
  body:JSON.stringify({action,id,convo:conversation,...body})
 }));
 return {status:response.status,body:await response.json()};
}
assert.match(sql,/ADD COLUMN IF NOT EXISTS edited_by uuid/);
assert.match(sql,/ADD COLUMN IF NOT EXISTS edited_by_name text/);
assert.match(script,/pg_dump --format=custom/);
assert.match(script,/EXPECTED_SHA/);
assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(app,/toLocaleString\('ru-RU',\{day:'2-digit',month:'2-digit',year:'numeric'/,'Every message displays a date');
assert.match(app,/editedByName/,'Edit attribution rendered alongside timestamp');
assert.match(menu,/key\.startsWith\('file:'\)&&!isMine\(message\)/,'Foreign message menu is accessible, legacy file restrictions remain');
assert.match(actions,/if\(kind==='message'\)/);
assert.match(actions,/menuEntry\('editMessage'/);
assert.match(actions,/mine\?menuEntry\('deleteMessage'/);
assert.match(app,/if\(!m\|\|m\.deletedAt\)return;editing=/,'Foreign authors can begin editing');
let r=await call('edit',{text:'Исправил другой участник',expectedEditedAt:null});
assert.equal(r.status,200);
assert.equal(r.body.message.authorId,author,'Original authorship must never change');
assert.equal(r.body.message.editedBy,peer);
assert.equal(r.body.message.editedByName,'Другой участник');
assert.equal(message.body,'Исправил другой участник');
assert.equal(updates,1);
r=await call('edit',{text:'Устаревшая правка',expectedEditedAt:null});
assert.equal(r.status,409,'Concurrent edit must not silently overwrite');
assert.equal(updates,1);
r=await call('delete',{expectedEditedAt:message.edited_at});
assert.equal(r.status,403,'Non-author deletion remains prohibited');
current=author;
r=await call('delete',{expectedEditedAt:message.edited_at});
assert.equal(r.status,200,'Original author retains deletion privilege');
assert.equal(message.body,'','Deleted body is irrevocably erased');
console.log('SHARED_MESSAGES_OK date=true foreign_edit=true editor_audit=true conflict_409=true author_only_delete=true');
