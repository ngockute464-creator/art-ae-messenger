import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('server/push-client.js','utf8');
const pub=Buffer.alloc(65,1).toString('base64url');
async function scenario(initialPermission,disabled=false){
 let permission=initialPermission,requested=0,subscriptions=0,subscribedPosts=0;
 const store=new Map(disabled?[['artae_push_explicitly_disabled_v1','1']]:[]);
 let banner=null;
 function element(tag){
  const el={tag,children:[],hidden:false,textContent:'',style:{},
   append(...children){this.children.push(...children)},
   setAttribute(){},remove(){if(banner===this)banner=null},
   addEventListener(name,fn){this['on'+name]=fn},
  };
  return el;
 }
 const document={
  body:{append(node){banner=node}},
  head:{append(){}},createElement:element,
  querySelector(sel){if(sel==='.app')return {};if(sel==='#artaePushWelcome')return banner;return null}
 };
 const reg={active:true,pushManager:{
  getSubscription:async()=>null,
  subscribe:async()=>{subscriptions++;return {endpoint:'https://push.example/sub',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'A',auth:'B'}}}}}
 }};
 const navigator={userAgent:'Desktop',serviceWorker:{getRegistration:async()=>reg,addEventListener(){}}};
 const window={PushManager:function(){},Notification:{},matchMedia:()=>({matches:false})};
 const Notification={get permission(){return permission},async requestPermission(){requested++;permission='granted';return permission}};
 const scheduled=[];
 const context={
  document,window,navigator,Notification,localStorage:{
   getItem:key=>store.get(key)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)
  },
  location:{href:'https://artae.example/'},history:{replaceState(){}},
  setTimeout(fn,ms){scheduled.push({fn,ms});return scheduled.length},
  clearTimeout(){},setInterval(){},AbortController,URL,URLSearchParams,Uint8Array,
  atob:s=>Buffer.from(s,'base64').toString('binary'),
  fetch:async(url,opts)=>{
   const action=new URL(String(url),'https://artae.example').searchParams.get('action');
   if(opts?.method==='POST')subscribedPosts++;
   return {ok:true,json:async()=>action==='config'?{enabled:true,publicKey:pub}:
     action==='status'?{subscribed:false}:{ok:true}};
  },
  console:{warn(){}}
 };
 runInNewContext(source,context);
 const start=scheduled.find(t=>t.ms===3500);
 assert.ok(start,'Default push must start after application initialization');
 start.fn();
 for(let i=0;i<30;i++)await Promise.resolve();
 await new Promise(setImmediate);
 return {get requested(){return requested},get subscriptions(){return subscriptions},
  get subscribedPosts(){return subscribedPosts},get banner(){return banner},
  store,Notification,flush:async()=>{for(let i=0;i<40;i++)await Promise.resolve();await new Promise(setImmediate)}};
}
let g=await scenario('granted');
assert.equal(g.requested,0,'Granted permission must not trigger another prompt');
assert.equal(g.subscriptions,1,'Granted permission automatically enrolls this device');
assert.equal(g.subscribedPosts,1);
let d=await scenario('default');
assert.ok(d.banner,'Default permission shows one invitation');
assert.equal(d.requested,0,'Never call requestPermission without a click');
assert.equal(d.subscriptions,0);
d.banner.children[1].onclick();await d.flush();
assert.equal(d.requested,1,'Button performs one real system permission request');
assert.equal(d.subscriptions,1);
let opted=await scenario('granted',true);
assert.equal(opted.subscriptions,0,'Explicit opt-out prevents auto subscribe');
assert.equal(opted.banner,null);
let denied=await scenario('denied');
assert.equal(denied.requested,0);
assert.equal(denied.banner,null);
console.log('PUSH_DEFAULTS_OK auto_if_granted=true button_only_prompt=true optout=true denied_respected=true');
