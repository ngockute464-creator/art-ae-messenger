import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const get=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const api=get('server/files-explorer.mjs'),parent=get('server/office-client.js'),frame=get('server/office-frame.js');
const isoParent=get('office-site/integration/office-client.js'),isoFrame=get('office-site/integration/office-frame.js');
test('same-name DOCX/XLSX Save writes back, not a download',()=>{
 assert.match(frame,/window\.L\.saveFile=async function\(savedName,blob\)/);
 assert.match(frame,/if\(savedName!==name\)return original\.call/);
 assert.match(frame,/artae-office-save-result/);
 assert.match(parent,/artaeOfficeSave/);
 assert.match(parent,/artae-office-save-command/);
});
test('server prevents stale overwrite for shared project files',()=>{
 assert.match(api,/action==='officeVersion'/);
 assert.match(api,/action==='officeSave'/);
 assert.match(api,/current\.modified!==args\.expectedModified/);
 assert.match(api,/status:409/);
});
test('large docs avoid function body limit, isolated office stays in sync',()=>{
 assert.match(api,/action==='officeSaveLink'/);
 assert.match(parent,/action:'officeSaveLink'/);
 assert.match(parent,/response\.status===413/);
 assert.doesNotMatch(frame,/msg\.buffer\.byteLength>3\*1024\*1024/);
 assert.match(isoFrame,/artae-office-save-command-done/);
 assert.match(isoParent,/action:'officeSaveLink'/);
});
test('VibeOffice declares success only after server acknowledgement',()=>{
 assert.match(frame,/if\(msg\.ok\)p\.resolve\('saved'\);else p\.reject/);
 assert.match(parent,/if\(!response\.ok\)throw Error/);
 assert.match(parent,/type:'artae-office-save-result'/);
 assert.match(parent,/active\?\.saving\|\|active\?\.savePreparing/);
});
