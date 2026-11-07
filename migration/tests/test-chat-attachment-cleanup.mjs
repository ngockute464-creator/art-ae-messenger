import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('migration/runtime/chat-attachment-cleanup.mjs','utf8');
const sync=readFileSync('migration/runtime/sync.mjs','utf8');
const server=readFileSync('migration/runtime/http-server.mjs','utf8');
const sql=readFileSync('migration/sql/006_chat_file_deletions.sql','utf8');
assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.artae_chat_file_deletions/);
assert.match(sql,/PRIMARY KEY\(message_id,file_id\)/);
assert.match(sql,/GRANT SELECT,INSERT,UPDATE,DELETE/);
assert.match(sync,/extractChatAttachmentRefs\(m\.body\)/);
assert.match(sync,/const updated=await transaction\(async tx=>/);
assert.match(sync,/SET body=\\'\\',deleted_at=\$4/);
assert.match(sync,/INSERT INTO public\.artae_chat_file_deletions/);
assert.match(server,/startChatAttachmentCleanup\(\)/);
assert.match(server,/stopChatAttachmentCleanup\(\)/);
// The release must never delete chat uploads on the UI or remove any copy from
// the visible project explorer; only the restricted hidden source folder.
const sanitized=source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'')+
 '\n;globalThis.parseRefs=extractChatAttachmentRefs;globalThis.pump=pumpChatAttachmentCleanup;';
const fileId='c577925f-aede-4daa-baba-58d49cb35d4e';
const projectId='8de0a273-4468-44fe-98ac-48f52bfd2e5d';
const messageId='56ddcd5b-2450-412f-b8c0-aebfd427cbb0';
const sample='Here [[chatfile:v1:'+fileId+':'+encodeURIComponent('Изображение 10.jpg')+':123456]]';
let parsed;
const run=async({shared=false,fail=false,missing=false,invalidFolder=false}={})=>{
 const calls=[],updates=[],warnings=[];
 const task={message_id:messageId,file_id:fileId,
  file_name:'Изображение 10.jpg',project_id:projectId,attempts:1};
 const sandbox={
  URL,AbortSignal,console:{warn:(...x)=>warnings.push(x.join(' ')),error:(...x)=>warnings.push(x.join(' '))},
  process:{env:{YANDEX_DISK_TOKEN:'FAKE_TOKEN_FOR_TESTS',ARTAE_NEXT_ALLOW_DISK_WRITES:'1'}},
  setTimeout(){return {unref(){}}},setInterval(){return {unref(){}}},clearInterval(){},
  query:async(query,params=[])=>{
   if(query.includes('to_regclass'))return {rows:[{name:missing?null:'public.artae_chat_file_deletions'}]};
   if(query.includes('WITH due AS'))return {rows:[task]};
   if(query.includes('SELECT p.folder_path,m.deleted_at'))return {rows:[{
    folder_path:invalidFolder?'app:/Other/Sub':'app:/TestProject',deleted_at:100
   }]};
   if(query.includes('SELECT 1 FROM public.artae_messages m')){
    assert.equal(params[0],projectId);
    assert.equal(params[1],'[[chatfile:v1:'+fileId+':');
    return {rows:shared?[{present:1}]:[]};
   }
   if(query.includes('UPDATE public.artae_chat_file_deletions SET')){
    updates.push(params);return {rowCount:1};
   }
   throw Error('Unexpected query: '+query);
  },
  fetch:async(url,options)=>{
   calls.push({url:String(url),options});
   if(fail)return {status:503};
   return {status:204};
  }
 };
 runInNewContext(sanitized,sandbox,{filename:'cleanup-runtime.mjs'});
 parsed=sandbox.parseRefs(sample+' '+sample);
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].fileName,'Изображение 10.jpg');
 await sandbox.pump();
 return {calls,updates,warnings};
};
let result=await run();
assert.equal(result.calls.length,1);
let url=new URL(result.calls[0].url);
assert.equal(url.origin,'https://cloud-api.yandex.net');
assert.equal(url.pathname,'/v1/disk/resources');
assert.equal(url.searchParams.get('path'),'app:/TestProject/!ФайлыИзЧатов/'+fileId+'__Изображение 10.jpg');
assert.equal(url.searchParams.get('permanently'),'true');
assert.equal(result.calls[0].options.method,'DELETE');
assert.equal(result.updates.length,1);
assert.equal(result.updates[0][2]!==null,true,'Successful deletion must finish job');
result=await run({shared:true});
assert.equal(result.calls.length,0,'Referenced attachment must not be deleted');
assert.equal(result.updates[0][4],'Shared attachment retained');
result=await run({fail:true});
assert.equal(result.calls.length,1);
assert.equal(result.updates[0][2],null,'Failed deletion must remain retryable');
result=await run({missing:true});
assert.equal(result.calls.length,0,'Do not use queue before schema migration');
result=await run({invalidFolder:true});
assert.equal(result.calls.length,0,'Must reject unsafe project folder');
console.log('CHAT_ATTACHMENT_CLEANUP_OK parse=true atomic=true retry=true shared_safe=true copied_files_safe=true');
