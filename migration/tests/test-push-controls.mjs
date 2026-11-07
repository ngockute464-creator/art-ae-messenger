// Reproduce a Service Worker/PushManager that never resolves.
// Controls must recover instead of remaining gray indefinitely.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';

const code=readFileSync('public/push-client.js','utf8');
const pub=Buffer.alloc(65,1).toString('base64url');
const flush=async()=>{for(let i=0;i<120;i++)await Promise.resolve()};
async function scenario(hang){
 const requests=[];
 const element=tag=>({
  tag,textContent:'',children:[],disabled:false,hidden:false,className:'',
  append(e){this.children.push(e)},
  addEventListener(type,fn){this['on'+type]=fn}
 });
 const panel=element('section');
 const document={createElement:element,head:{append(){}}};
 const notification={permission:'granted',requestPermission:async()=> 'granted'};
 const serviceWorker={
  async getRegistration(){
   return {active:true,pushManager:{
    getSubscription:()=>hang?new Promise(()=>{}):Promise.resolve(null),
    subscribe:async()=>({endpoint:'https://fcm.googleapis.com/fcm/send/example',
      toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'key',auth:'key'}}}})
   }};
  },
  addEventListener(){}
 };
 const window={
  PushManager:function(){},Notification:notification,
  matchMedia:()=>({matches:true}),navigator:{standalone:true}
 };
 const navigator={serviceWorker,userAgent:'Test',standalone:true};
 const context={window,navigator,document,Notification:notification,
  URL,URLSearchParams,Uint8Array,AbortController,
  atob:s=>Buffer.from(s,'base64').toString('binary'),
  location:{href:'https://artae.example/'},history:{replaceState(){}},
  setTimeout(fn,ms){if(ms===8000)queueMicrotask(fn);return 1},
  clearTimeout(){},setInterval(){},
  fetch:async(uri,options)=>{
   const method=options?.method||'GET';
   requests.push({uri,method});
   const json=method==='POST'?{ok:true}:
    String(uri).includes('action=config')?{enabled:true,publicKey:pub}:
    {subscribed:false};
   return {ok:true,json:async()=>json};
  },
  console:{warn(){}}
 };
 runInNewContext(code,context,{filename:'push-client.js'});
 assert.equal(typeof window.ARTAE_PUSH_MOUNT,'function');
 window.ARTAE_PUSH_MOUNT(panel);
 await flush();
 const [label,status,row]=panel.children;
 const [enable,disable,test]=row.children;
 assert.equal(label.textContent,'Уведомления');
 assert.equal(enable.disabled,false,'Enable must never remain locked after worker check');
 assert.equal(enable.hidden,false);
 assert.equal(disable.hidden,true);
 assert.equal(test.hidden,true);
 if(hang){
  assert.match(status.textContent,/Push Manager не отвечает/);
  enable.onclick();
  await flush();
  assert.equal(enable.disabled,false,'Enable must unlock after failed subscription');
  assert.match(status.textContent,/Push Manager не отвечает/);
 }else{
  assert.match(status.textContent,/Уведомления выключены/);
  enable.onclick();
  await flush();
  assert.equal(enable.hidden,true,'Successful subscription hides enable');
  assert.equal(disable.hidden,false);
  assert.equal(test.hidden,false);
  assert.match(status.textContent,/Уведомления включены/);
  assert.ok(requests.some(r=>r.method==='POST'));
 }
}
await scenario(true);
await scenario(false);
console.log('PUSH_CONTROLS_TEST_OK worker_timeout_recovers=true subscription_works=true');
