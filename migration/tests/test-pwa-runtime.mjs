// PWA updater behavior checks in an isolated fake browser: no real user data.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync('public/pwa-client.js','utf8');
const meta=JSON.parse(readFileSync('public/app-version.json','utf8'));
const oldBuild='0'.repeat(40),newBuild=meta.build;
async function scenario({initiallySafe,remoteBuild}){
 let clock=10000,safe=initiallySafe,redirected=[],calls=0;
 const timers=[],intervals=[];
 const fakeNode=()=>({textContent:'',className:'',hidden:false,disabled:false,
  setAttribute(){},append(){},remove(){},addEventListener(){}});
 const document={
  hidden:false,readyState:'complete',activeElement:null,
  createElement:fakeNode,
  querySelector(selector){
   if(selector==='meta[name="artae-build"]')return {content:oldBuild};
   if(selector==='meta[name="artae-version"]')return {content:'test'};
   return null;
  },
  addEventListener(){},head:{append(){}},body:{append(){}}
 };
 const window={
  ARTAE_CAN_AUTO_RELOAD:()=>safe,
  addEventListener(){},
  matchMedia(){return {matches:false}},
 };
 const navigator={
  onLine:true,userAgent:'test',platform:'test',maxTouchPoints:0,
  serviceWorker:{
   getRegistration:async()=>({update:async()=>{}}),
   addEventListener(){}
  }
 };
 const fakeLocation={
  href:'https://artae.example/?sample=1#chat',replace(href){redirected.push(href);}
 };
 class FakeDate extends Date {static now(){return clock}}
 const ctx={document,window,navigator,location:fakeLocation,Date:FakeDate,URL,
  setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length},
  fetch:async(url,opts)=>{
   calls++;
   assert.ok(String(url).startsWith('/app-version.json?check='));
   assert.equal(opts.cache,'no-store');
   return {ok:true,json:async()=>({version:meta.version,build:remoteBuild})};
  },
  console:{warn(){}}
 };
 runInNewContext(source,ctx,{filename:'pwa-client.js'});
 assert.ok(timers.some(t=>t.ms===3000),'Startup version check absent');
 const first=timers.find(t=>t.ms===3000);
 clock+=3500;
 first.fn();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(redirected.length,0,'Reload during first interaction or unsafe editing');
 if(remoteBuild===oldBuild){
  clock+=15000;intervals.find(t=>t.ms===2000)?.fn();
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(redirected.length,0,'Must not reload current release');
 }else{
  clock+=15000;
  intervals.find(t=>t.ms===2000)?.fn();
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(redirected.length,initiallySafe?1:0,
   initiallySafe?'Safe state must auto reload':'Unsafe state must defer reload');
  if(!initiallySafe){
   safe=true;clock+=15000;
   intervals.find(t=>t.ms===2000)?.fn();
   for(let i=0;i<20;i++)await Promise.resolve();
   assert.equal(redirected.length,1,'Must auto reload when draft/editing ends');
  }
  assert.ok(redirected[0].includes('app_build='+remoteBuild.slice(0,12)));
 }
 assert.ok(calls>=1);
}
await scenario({initiallySafe:true,remoteBuild:newBuild});
await scenario({initiallySafe:false,remoteBuild:newBuild});
await scenario({initiallySafe:true,remoteBuild:'0'.repeat(40)});
console.log('PWA_AUTOUPDATE_BEHAVIOR_OK safe_reload=true dirty_deferred=true current_unchanged=true');
