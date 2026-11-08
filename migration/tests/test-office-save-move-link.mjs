// Regression: Yandex move returns a resource Link for synchronous 201
// and an operations Link for asynchronous 202. Never treat both as polling URLs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function source(path){
 const text=readFileSync(path,'utf8');
 const found=text.match(/function classifyOfficeMoveLink\(href\)\{[\s\S]*?^\}/m);
 assert.ok(found,path+' must classify Yandex move result');
 assert.match(text,/const move=classifyOfficeMoveLink\(operation\.href\)/);
 assert.match(text,/if\(!move\.completed\)for\(let attempt=0;attempt<12;attempt\+\+\)/);
 return found[0];
}
const staging=source('server/files-explorer.mjs');
assert.equal(source('migration/runtime/files-explorer.mjs'),staging,
 'Production PostgreSQL runtime and source must classify identically');
const classify=runInNewContext(
 'const transferUrl=href=>{const u=new URL(href);'+
 'if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443")throw Error("Unsafe URL");return u};'+
 staging+'; classifyOfficeMoveLink', {URL,Error,Object}
);
const completed=classify('https://cloud-api.yandex.net/v1/disk/resources?path=app%3A%2Fdoc.docx');
assert.equal(completed.completed,true,'201 resource Link is already complete');
assert.equal(classify('https://cloud-api.yandex.net/v1/disk/operations/abc123-a').id,'abc123-a');
assert.equal(classify('https://cloud-api.yandex.net/v1/disk/operations/abc123-a').completed,false);
for(const url of [
 'https://evil.example/v1/disk/resources?path=x',
 'https://cloud-api.yandex.net/v1/disk/unknown',
 'https://cloud-api.yandex.net/v1/disk/operations/abc123-a?redirect=https://example.com',
 'https://cloud-api.yandex.net/v1/disk/resources',
 'http://cloud-api.yandex.net/v1/disk/resources?path=x'
]){
 assert.throws(()=>classify(url),undefined,url);
}
console.log('OFFICE_SAVE_MOVE_LINK_OK synchronous=true asynchronous=true invalid_links_blocked=true');
