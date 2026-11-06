import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file=readFileSync(new URL('../server/files-client.js',import.meta.url),'utf8');
const patch=readFileSync(new URL('../server/files-patch.mjs',import.meta.url),'utf8');
test('download appears once in three-dot menu, not as separate arrow',()=>{
 const block=file.slice(file.indexOf('const canOffice='),file.indexOf("}).join('');",file.indexOf('const canOffice=')));
 assert.equal((block.match(/data-act="filesDownload"/g)||[]).length,1);
 assert.match(block,/role="menuitem">Скачать/);
 assert.doesNotMatch(block,/title="Скачать" aria-label/);
});
test('file preview still opens by name and pin still toggles directly',()=>{
 assert.match(file,/class="fileEntryNameAction" data-act="filesPreview"/);
 assert.match(file,/data-act="pinFile"/);
});
test('unified 14px font targets main text without document editor iframe',()=>{
 assert.match(patch,/\.sidebar \.navitem \.navname,\.convos \.navitem \.navname,\.msgtext,\.fileEntryNameAction/);
 assert.match(patch,/font-family:Arial,Helvetica,sans-serif;font-size:14px/);
});
