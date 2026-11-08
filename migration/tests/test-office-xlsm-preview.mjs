// XLSM is supported solely as a native, read-only Ledger preview.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const files=readFileSync('server/files-client.js','utf8');
const client=readFileSync('server/office-client.js','utf8');
const bridge=readFileSync('server/office-frame.js','utf8');
const app=readFileSync('public/office/ledger/js/app.js','utf8');
const reader=readFileSync('public/office/ledger/js/xlsx-read.js','utf8');
const source=readFileSync('public/app.js','utf8');
assert.match(app,/\.xlsx,\.xlsm/,'Pinned Ledger accepts XLSM');
assert.match(reader,/vbaProject/,'Pinned Ledger recognizes VBA package');
assert.match(files,/\(docx\|xlsx\|xlsm\)/,'Explorer uses Office preview for XLSM');
assert.match(files,/\['xls','xlsx','xlsm','ods'\]/,'XLSM retains Excel icon');
assert.match(files,/const canOffice=\/\\\.\(docx\|xlsx\)\$\/i/,'Only DOCX and XLSX offer edit action');
assert.match(client,/\(docx\|xlsx\|xlsm\)/,'Office client routes XLSM to Ledger');
assert.match(client,/if\(\/\\\.xlsm\$\/i\.test\(name\)&&mode!=='preview'\)return/,'Client rejects XLSM editing');
assert.match(bridge,/ext==='xlsm'&&\(msg\.readonly!==true\|\|msg\.remoteSave===true\)/,
 'Frame rejects XLSM editing and remote save');
assert.match(bridge,/application\/vnd\.ms-excel\.sheet\.macroEnabled\.12/,'XLSM MIME type is correct');
assert.match(bridge,/viewOnly\(\)\.activate\(document\.documentElement\.dataset\.app\)/,
 'Read-only transaction guard remains active');
assert.match(source,/function explorerPreview\(/,'Explorer client included in production build');
assert.match(readFileSync('public/app-version.json','utf8'),/"version":"0\\.4\\.15-preview"/);
console.log('OFFICE_XLSM_PREVIEW_OK ledger=true read_only=true edit_blocked=true macro_not_executed=true');
