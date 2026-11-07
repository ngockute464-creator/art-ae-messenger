// End-to-end mocked project video GET/HEAD + copy-picker completion behavior.
// No external Yandex calls or production DB writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const api=readFileSync('migration/runtime/files-explorer.mjs','utf8');
const http=readFileSync('migration/runtime/http-server.mjs','utf8');
const viewer=readFileSync('server/files-client.js','utf8');
const picker=readFileSync('server/chat-media-client.js','utf8');
const styles=readFileSync('public/styles.css','utf8');
const built=readFileSync('public/app.js','utf8');
assert.ok(http.includes("['chatMedia','projectMedia'].includes"));
assert.ok(viewer.includes("action:'projectMedia',project:explorer.project||project,path"));
assert.ok(built.includes("action:'projectMedia',project:explorer.project||project,path"));
assert.match(styles,/\.chatMediaPickerFooter>\[hidden\]\{display:none!important\}/);
assert.ok(viewer.includes("}else if(kind===\'video\'){"));
assert.ok(viewer.includes("action:\'projectMedia\',project:explorer.project||project,path"));
const projectId='11111111-1111-4111-8111-111111111111';
const path='Clips/original.mp4';
let authorized=true;
const events=[];
const fake={
 URL,Request,Response,Headers,AbortSignal,Uint8Array,console,
 process:{env:{YANDEX_DISK_TOKEN:'TEST_VALUE'}},
 getSession:async()=>authorized?{user:{id:projectId}}:null,
 query:async(sql)=>{
  if(sql.includes('FROM public.artae_projects'))return{rows:[{id:projectId,folder_path:'app:/TestProject'}]};
  throw Error('Unexpected query '+sql);
 },
 fetch:async(uri,opts)=>{
  const url=new URL(uri);events.push({url,opts});
  if(url.pathname==='/v1/disk/resources'){
   assert.equal(url.searchParams.get('path'),'app:/TestProject/'+path);
   return Response.json({type:'file',size:10000000});
  }
  if(url.pathname==='/v1/disk/resources/download')return Response.json({
   href:'https://downloader.disk.yandex.ru/signed-sample'});
  if(url.pathname==='/signed-sample'){
   const range=opts.headers?.Range;
   if(range)return new Response(new Uint8Array([11,12]),{status:206,
    headers:{'Content-Range':'bytes 0-1/10000000','Content-Length':'2','Accept-Ranges':'bytes'}});
   return new Response(new Uint8Array([11,12,13]),{status:200,
    headers:{'Content-Length':'3','Accept-Ranges':'bytes'}});
  }
  throw Error('Unexpected HTTP request '+url.pathname);
 }
};
const cleaned=api.replace(/^import .*;\r?\n/gm,'')
 .replace('export default async function handler(request){','async function handler(request){')+
 '\n;globalThis.testProjectHandler=handler;';
runInNewContext(cleaned,fake);
const request=(method='GET',range=null,p=path)=>{
 const qs=new URLSearchParams({action:'projectMedia',project:projectId,path:p});
 return new Request('https://artae.example/.netlify/functions/files-explorer?'+qs,
  {method,headers:range?{Range:range}:{}});
};
let response=await fake.testProjectHandler(request('HEAD'));
assert.equal(response.status,200);
assert.equal(response.headers.get('content-length'),'10000000');
assert.equal(response.headers.get('content-type'),'video/mp4');
assert.equal(response.body,null);
assert.equal(events.some(x=>x.url.pathname==='/signed-sample'),false,'HEAD must not download any bytes');
response=await fake.testProjectHandler(request('GET','bytes=0-1'));
assert.equal(response.status,206);
assert.equal(response.headers.get('content-length'),'2');
assert.equal(response.headers.get('content-range'),'bytes 0-1/10000000');
assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[11,12]);
assert.ok(events.some(x=>x.url.pathname==='/signed-sample'&&x.opts.headers?.Range==='bytes=0-1'));
response=await fake.testProjectHandler(request());
assert.equal(response.status,200);
assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[11,12,13]);
assert.equal((await fake.testProjectHandler(request('GET',null,'../private.mp4'))).status,400);
assert.equal((await fake.testProjectHandler(request('GET',null,'!ФайлыИзЧатов/secret.mp4'))).status,403);
assert.equal((await fake.testProjectHandler(request('GET',null,'Clips/index.html'))).status,415);
authorized=false;
assert.equal((await fake.testProjectHandler(request('HEAD'))).status,401);
// A successful save must have a SINGLE bottom action: Done closes the dialog.
const start=picker.indexOf('function chatMediaCopyPicker(source){');
assert.ok(start!==-1);
const code=picker.slice(start)+'\n;globalThis.testOpenPicker=chatMediaCopyPicker;';
const created=[];
const element=(name)=>({
 name,hidden:false,disabled:false,textContent:'',value:'',open:false,
 children:[],listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},
 setAttribute(){},append(x){this.children.push(x)},replaceChildren(...items){this.children=items},
 focus(){},remove(){},
 click(){this.listeners.click?.()},
 showModal(){this.open=true},
 close(){this.open=false;this.listeners.close?.()}
});
const dialog=element('dialog');
const nodes=Object.fromEntries(['.chatMediaPickerHeader button','[data-copy-cancel]',
 '[data-copy-save]','#chatMediaCopyName','[data-copy-status]',
 '[data-copy-location]','[data-copy-folders]'].map(k=>[k,element(k)]));
dialog.querySelector=(key)=>nodes[key];
const userDoc={body:{append(x){created.push(x)}},createElement(name){
 if(name==='dialog')return dialog;
 return element(name);
}};
let callCount=0;
const sandbox={
 document:userDoc,console,URL,URLSearchParams,Promise,setTimeout,clearTimeout,
 chatApi:async(action)=>{
  assert.equal(action,'chatCopyToProject');
  callCount++;
  return {ok:true,done:true,path:'Clips/renamed.mp4'};
 },
 explorerApi:async()=>({items:[],hasMore:false}),
 explorer:{project:'different',path:''},view:'chat',railFileVisible:()=>false,
 explorerLoad(){throw Error('Unexpected refresh')},
};
runInNewContext(code,sandbox);
sandbox.testOpenPicker({project:projectId,convo:'convo',fileId:'file',messageId:'message',name:'original.mp4'});
await Promise.resolve();
const save=nodes['[data-copy-save]'];
nodes['#chatMediaCopyName'].value='renamed.mp4';
save.click();
for(let i=0;i<15;i++)await Promise.resolve();
assert.equal(callCount,1);
assert.equal(save.textContent,'Готово');
assert.equal(save.disabled,false);
assert.equal(nodes['[data-copy-cancel]'].hidden,true);
assert.equal(dialog.open,true);
save.click();
assert.equal(dialog.open,false,'Done should close the finished dialog');
assert.equal(callCount,1,'Done must never create a second copy');
console.log('PROJECT_VIDEO_AND_COPY_DONE_OK stream=true head=true range=true auth=true done_single=true');
