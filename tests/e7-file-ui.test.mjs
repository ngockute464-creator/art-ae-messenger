import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../server/files-client.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../server/files-patch.mjs',import.meta.url),'utf8');
test('file row opens preview via name without magnifier',()=>{const block=source.slice(source.indexOf('const canOffice='),source.indexOf("}).join('');",source.indexOf('const canOffice=')));assert.match(block,/fileEntryNameAction/);assert.match(block,/data-act="filesPreview"/);assert.doesNotMatch(block,/🔍/);});
test('menu has edit only for Office and delete action',()=>{assert.match(source,/fileMoreMenu/);assert.match(source,/data-act="officeEdit"/);assert.match(source,/data-act="filesDelete"/);});
test('pins retain direct toggle and tilted pinned style',()=>{assert.match(source,/data-act="pinFile"/);assert.match(css,/rotate\(-35deg\)/);});
