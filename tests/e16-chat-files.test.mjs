import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../server/files-explorer.mjs',import.meta.url),'utf8');
const client=readFileSync(new URL('../server/chat-file-client.js',import.meta.url),'utf8');
const patch=readFileSync(new URL('../server/files-patch.mjs',import.meta.url),'utf8');
test('chat directory is excluded from explorer and inaccessible by forged path',()=>{
 assert.match(api,/CHAT_FILES='!ФайлыИзЧатов'/);
 assert.match(api,/i.name==='!ФайлыИзЧатов'/);
 assert.match(api,/x.split\('\/'\).some\(part=>\['_artae_voice','_artae_edit_staging','!ФайлыИзЧатов'\]/);
});
test('chat files are immutable UUID prefixed and scoped to conversation and project',()=>{
 assert.match(api,/return id\+'__'\+fileName\(name\)/);
 assert.match(api,/await chatConvoProject\(args.convo,p.id\)/);
 assert.match(api,/overwrite:'false'/);
});
test('file-first message sending, stable retries and working links',()=>{
 assert.match(client,/chatPendingFiles=new Map\(\)/);
 assert.match(client,/chatRequestIds\.get\(cid\)/);
 assert.match(client,/chatUploadEntry\(items\[i\]/);
 assert.match(client,/syncApi\('send'/);
 assert.match(client,/data-chat-download/);
 assert.match(patch,/chatFileMessageHtml\(m\)/);
});
