import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const files=readFileSync('server/files-client.js','utf8');
const main=readFileSync('server/office-client.js','utf8');
const cross=readFileSync('office-site/integration/office-client.js','utf8');
test('DOCX/XLSX preview routes to Office and not legacy text preview',()=>{
 assert.match(files,/async function explorerPreview\(path,name,mime\)\{\s*if\(\/\\\.\(docx\|xlsx\)\$\/i\.test\(name\)\)/);
 assert.match(files,/window\.ARTAE_OFFICE_PREVIEW\(path,name,explorer\.project\|\|project\)/);
});
test('both clients expose Office preview API and do not swallow preview clicks',()=>{
 for(const client of [main,cross]){
  assert.match(client,/window\.ARTAE_OFFICE_PREVIEW=/);
  assert.match(client,/closest\('\[data-act="officeEdit"\]'\)/);
  assert.doesNotMatch(client,/closest\('\[data-act="officeEdit"\],\[data-act="filesPreview"\]'\)/);
 }
});
test('active document responds visibly rather than silently returning',()=>{
 for(const client of [main,cross])assert.match(client,/if\(active\)\{\s*alert\('Сначала закройте открытый документ/);
});
