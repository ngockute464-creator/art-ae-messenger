import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const api=read('server/files-explorer.mjs');
const locks=read('sql/office-locks.sql');
const client=read('server/office-client.js');
const isolated=read('office-site/integration/office-client.js');
const patch=read('server/files-patch.mjs');
test('exclusive cross-device lock is atomic and expires',()=>{
 assert.match(locks,/PRIMARY KEY\(project_id,file_path\)/);
 assert.match(locks,/ON CONFLICT\(project_id,file_path\) DO UPDATE/);
 assert.match(locks,/WHERE artae_office_locks.expires_at<=now\(\)/);
 assert.match(locks,/interval '120 seconds'/);
 assert.match(locks,/REVOKE ALL ON FUNCTION/);
});
test('locked Office file cannot be modified through ordinary explorer',()=>{
 assert.match(api,/await guardOfficeFile\(p.id,rel,session\)/);
 assert.match(api,/await guardOfficeFile\(p.id,rel\?rel\+'\/'\+name:name,session\)/);
 assert.match(api,/await requireOfficeLease\(p.id,rel,args.editToken,session\)/);
 assert.match(api,/action==='officeSaveCommit'/);
});
test('Office obtains lock before editor and releases on close, retries renewal',()=>{
 assert.match(client,/await officeLeaseRequest\('officeEditAcquire'/);
 assert.match(client,/officeLeaseRequest\('officeEditRenew'/);
 assert.match(client,/officeLeaseRequest\('officeEditRelease'/);
 assert.match(client,/ctx.leaseFailed/);
 assert.match(isolated,/await officeLeaseRequest\('officeEditAcquire'/);
});
test('message edit controls stay on one row with saved handlers',()=>{
 assert.match(patch,/message edit attach inline/);
 assert.match(patch,/data-act="addEditFile"/);
 assert.match(patch,/type="submit">Сохранить<\/button>/);
 assert.match(patch,/data-act="cancelEdit"/);
 assert.match(patch,/\.messageEdit \.editActions\{display:flex;flex-wrap:nowrap/);
});
