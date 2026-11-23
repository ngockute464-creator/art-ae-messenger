import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('server/push-client.js','utf8');
async function caseRun({permission='default',server='enabled',startReady=true,subscribeFails=false}={}){
 const timers=[],requests=[];
 let appReady=startReady,permissionRequests=0,subscriptions=0,banner=null;
 const node=tag=>({tag,children:[],textContent:'',disabled:false,
  append(...children){this.children.push(...children)},
  setAttribute(){},addEventListener(name,fn){this['on'+name]=fn},
  remove(){if(banner===this)banner=null}
 });
 const doc={
  body:{append(el){banner=el}},head:{append(){}},createElement:node,
  get hidden(){return false},
  querySelector(sel){if(sel==='.app')return appReady?{}:null;if(sel==='#artaePushWelcome')return banner;return null}
 };
 const notification={permission,requestPermission(){permissionRequests++;permission='granted';return Promise.resolve('granted')}};
 const registration={active:true,pushManager:{
  getSubscription:async()=>null,
  subscribe:async()=>{subscriptions++;return {endpoint:'https://fcm.googleapis.com/fcm/send/123456789',
   toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'a'.repeat(80),auth:'b'.repeat(24)}}}}}
 }};
 const ctx={
  document:doc,window:{PushManager:function(){},Notification:notification,matchMedia:()=>({matches:true})},
  navigator:{userAgent:'Android',standalone:true,serviceWorker:{getRegistration:async()=>registration,addEventListener(){}}},
  Notification:notification,localStorage:{getItem:()=>null,removeItem(){},setItem(){}},
  URL,URLSearchParams,AbortController,Uint8Array,
  location:{href:'https://artae.example/'},history:{replaceState(){}},
  atob:s=>Buffer.from(s,'base64').toString('binary'),
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},
  clearTimeout(){},setInterval(fn,ms){timers.push({fn,ms});return timers.length},
  fetch:async(url,opts)=>{
   requests.push({url:String(url),method:opts?.method||'GET'});
   if(server==='offline')throw Error('Сервер недоступен');
   if(opts?.method==='POST'&&subscribeFails)throw Error('Не удалось сохранить подписку');
   const action=new URL(String(url),'https://artae.example').searchParams.get('action');
   const json=opts?.method==='POST'?{ok:true}:action==='config'?
    {enabled:server!=='disabled',publicKey:server==='disabled'?null:Buffer.alloc(65,1).toString('base64url')}:
    {subscribed:false};
   return {ok:true,json:async()=>json};
  },
  console:{warn(){}}
 };
 runInNewContext(source,ctx);
 const tick=async fn=>{fn();for(let i=0;i<100;i++)await Promise.resolve();await new Promise(setImmediate)};
 const start=timers.find(t=>t.ms===1200);
 assert.ok(start,'Startup push task exists');
 await tick(start.fn);
 return {get banner(){return banner},get permissionRequests(){return permissionRequests},
  get subscriptions(){return subscriptions},get requests(){return requests},
  async onNextTick(){appReady=true;const interval=timers.find(t=>t.ms===5000);assert.ok(interval);await tick(interval.fn)},
  async clickPrimary(){assert.ok(banner);banner.children[1].onclick();for(let i=0;i<100;i++)await Promise.resolve();await new Promise(setImmediate)}
 };
}
let delayed=await caseRun({startReady:false});
assert.equal(delayed.banner,null,'No onboarding while app is not authenticated');
assert.equal(delayed.requests.length,0);
await delayed.onNextTick();
assert.match(delayed.banner.children[0].textContent,/Получать уведомления/,'Login during runtime surfaces the prompt');
let broken=await caseRun({server:'offline'});
assert.match(broken.banner.children[0].textContent,/Сервер недоступен/,'API failure visible instead of silent');
assert.equal(broken.permissionRequests,0);
let disabled=await caseRun({server:'disabled'});
assert.match(disabled.banner.children[0].textContent,/сервер Push пока не настроен/);
assert.equal(disabled.permissionRequests,0);
let accepted=await caseRun({permission:'default'});
assert.match(accepted.banner.children[0].textContent,/Получать уведомления/);
assert.equal(accepted.permissionRequests,0,'No request before click');
await accepted.clickPrimary();
assert.equal(accepted.permissionRequests,1);
assert.equal(accepted.subscriptions,1);
assert.equal(accepted.banner,null);
let alreadyGrantedBroken=await caseRun({permission:'granted',subscribeFails:true});
assert.match(alreadyGrantedBroken.banner.children[0].textContent,/Не удалось сохранить подписку/,'Previously granted permission must show subscription failure');
assert.equal(alreadyGrantedBroken.permissionRequests,0);
let alreadyGranted=await caseRun({permission:'granted'});
assert.equal(alreadyGranted.banner,null,'Already enabled devices need no repeated permission dialog');
assert.equal(alreadyGranted.subscriptions,1,'Already granted auto subscribe');
console.log('PUSH_ONBOARDING_RECOVERY_OK delayed_login=true visible_server_failure=true visible_subscription_failure=true existing_permission_auto=true');
