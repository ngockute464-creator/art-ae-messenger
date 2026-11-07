import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const sync=read('migration/runtime/sync.mjs'),project=read('server/files-client.js'),
 chat=read('server/chat-file-client.js'),office=read('server/office-client.js'),
 sql=read('migration/sql/005_erase_deleted_text.sql');
assert.ok(sync.includes("SET body=\\'\\',deleted_at=$4"));
assert.ok(sync.includes("text:r.deleted_at===null?r.body:''"));
assert.ok(sql.includes("UPDATE public.artae_messages SET body=''"));
assert.ok(sql.includes("CHECK (deleted_at IS NULL OR body='')"));
for(const s of [project,chat,office])assert.ok(!s.includes('size<=3*1024*1024'));
assert.ok(project.includes('explorerSendDirect(file,id,path,overwrite)'));
assert.ok(project.includes("const link=await explorerApi('downloadLink',{project,path})"));
assert.ok(chat.includes("await chatApi('chatUploadLink',params)"));
assert.ok(office.includes("action:'officeSaveCommit'"));
console.log('MESSAGE_ERASURE_FILES_TEST_OK');
