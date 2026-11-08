// XLSM is supported solely as a native, read-only Ledger preview.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const files=readFileSync('server/files-client.js','utf8');
const client=readFileSync('server/office-client.js','utf8');
const bridge=readFileSync('server/office-frame.js','utf8');
const server=readFileSync('server/files-explorer.mjs','utf8');
const runtime=readFileSync('migration/runtime/files-explorer.mjs','utf8');
for(const [label,code] of [['server',server],['runtime',runtime]]){
 const version=code.match(/if\(args\.action==='officeVersion'[\s\S]*?if\(!rel\|\|!\/\\\.\(([^)]*)\)\$\/i\.test\(rel\)\)/);
 assert.ok(version,label+' must validate officeVersion');
 assert.equal(version[1],'docx|xlsx|xlsm',label+' must accept XLSM metadata');
 for(const action of ['officeEditAcquire','officeSave','officeSaveLink','officeSaveCommit']){
  assert.ok(code.includes(action),label+' still has '+action);
 }
 assert.ok(code.includes('Редактировать можно только DOCX и XLSX'),
  label+' edit lease must not accept XLSM');
 const blocks=code.match(/!\/\\\.\(docx\|xlsx\)\$\/i\.test\(rel\)/g)||[];
 assert.ok(blocks.length>=4,label+' write guards remain DOCX/XLSX only');
}

const app=readFileSync('public/office/ledger/js/app.js','utf8');
const reader=readFileSync('public/office/ledger/js/xlsx-read.js','utf8');
const source=readFileSync('public/app.js','utf8');
assert.ok(app.includes('.xlsx,.xlsm'),'Pinned Ledger accepts XLSM');
assert.ok(reader.includes('vbaProject'),'Pinned Ledger recognizes VBA package');
assert.ok(files.includes('(docx|xlsx|xlsm)'),'Explorer uses Office preview for XLSM');
assert.ok(files.includes("['xls','xlsx','xlsm','ods']"),'XLSM retains Excel icon');
assert.ok(files.includes('const canOffice=')&&!files.includes('const canOffice=/(docx|xlsx|xlsm)'),
 'XLSM must not offer editing action');
assert.ok(client.includes('(docx|xlsx|xlsm)'),'Office client routes XLSM to Ledger');
assert.ok(client.includes("mode!=='preview')return"),'Client rejects XLSM editing');
assert.ok(bridge.includes("ext==='xlsm'&&(msg.readonly!==true||msg.remoteSave===true)"),
 'Frame rejects XLSM editing and remote save');
assert.ok(bridge.includes('application/vnd.ms-excel.sheet.macroEnabled.12'),'XLSM MIME type');
assert.ok(bridge.includes('viewOnly().activate(document.documentElement.dataset.app)'),
 'Read-only transaction guard remains active');
assert.ok(source.includes('function explorerPreview('),'Explorer included in assembled app');
const version=JSON.parse(readFileSync('public/app-version.json','utf8'));
assert.equal(version.version,'0.4.17-preview');
console.log('OFFICE_XLSM_PREVIEW_OK ledger=true readonly=true edit_blocked=true');
