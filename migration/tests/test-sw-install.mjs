// Verify the generated, deployed Service Worker script can install and activate
// even when an individual offline asset returns HTTP 404.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync('public/sw.js','utf8');
const m=code.match(/const FILES=(\[[^;]+\]);/);
assert.ok(m,'Generated SW must declare its precache resources');
const files=JSON.parse(m[1].replace(/'/g,'"'));
for(const file of files){
 const path=file==='./'?'public/index.html':'public/'+file.replace(/^\.\//,'');
 assert.ok(existsSync(path),'Referenced precache asset is missing: '+path);
}
const listeners=new Map();
const offlineCache=new Map();
let skipCount=0,claimCount=0;
const registration={scope:'https://artae.duckdns.org/'};
const context={
 URL,Request,Response,Promise,Set,console:{warn:(...args)=>console.log('[SIMULATED SW]',...args)},
 self:{
  registration,location:{origin:'https://artae.duckdns.org'},
  addEventListener:(name,handler)=>listeners.set(name,handler),
  skipWaiting:async()=>{skipCount++},
  clients:{claim:async()=>{claimCount++}}
 },
 caches:{
  open:async()=>({put:async(req,res)=>{offlineCache.set(req.url,res)}}),
  keys:async()=>['art-ae-old-preview'],
  delete:async()=>true
 },
 fetch:async req=>({
  ok:!req.url.endsWith('/auth.css'),
  status:req.url.endsWith('/auth.css')?404:200,
  clone(){return this}
 })
};
runInNewContext(code,context,{filename:'built-sw.js'});
assert.equal(typeof listeners.get('install'),'function');
assert.equal(typeof listeners.get('activate'),'function');
let installPromise;
listeners.get('install')({waitUntil:p=>{installPromise=p}});
assert.ok(installPromise);
await installPromise;
assert.equal(skipCount,1,'SW must skip waiting even after missing optional file');
console.log('SW_SIMULATION_CACHED',offlineCache.size,'EXPECTED',files.length-1);
assert.ok(offlineCache.size>=files.length-1,'Unfailed assets must remain cached');
let activatePromise;
listeners.get('activate')({waitUntil:p=>{activatePromise=p}});
await activatePromise;
assert.equal(claimCount,1,'SW must claim clients');
console.log('SW_INSTALL_TEST_OK missing_asset_tolerated=true active=true files='+files.length);
