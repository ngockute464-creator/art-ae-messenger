import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const api=readFileSync('migration/runtime/files-explorer.mjs','utf8');
const bridge=readFileSync('migration/runtime/http-server.mjs','utf8');
const viewer=readFileSync('server/files-client.js','utf8');
const assembled=readFileSync('public/app.js','utf8');
assert.match(bridge,/const isChatMedia=url\.pathname===PREFIX\+'files-explorer'/);
assert.match(bridge,/if\(key==='content-length'&&!isChatMedia\)continue;/);
assert.match(viewer,/media\.addEventListener\('error'/);
assert.match(viewer,/Сохранить оригинал на устройство/);
assert.match(assembled,/Сохранить оригинал на устройство/);
const ids={
 project:'11111111-1111-4111-8111-111111111111',
 convo:'22222222-2222-4222-8222-222222222222',
 file:'33333333-3333-4333-8333-333333333333',
 message:'44444444-4444-4444-8444-444444444444'
};
const origin='https://artae.example';
const marker='[[chatfile:v1:'+ids.file+':clip.mp4:9000000]]';
const events=[];
let allow=true;
const mock={
 URL,Request,Response,Headers,AbortSignal,Uint8Array,TextDecoder,TextEncoder,console,
 process:{env:{YANDEX_DISK_TOKEN:'test-only-secret',ARTAE_NEXT_ALLOW_DISK_WRITES:'1'}},
 getSession:async()=>allow?{user:{id:ids.project}}:null,
 query:async(sql,params)=>{
  if(sql.includes('FROM public.artae_projects'))
   return {rows:[{id:ids.project,name:'Example',folder_path:'app:/Example'}]};
  if(sql.includes('FROM public.artae_conversations'))
   return {rows:[{id:ids.convo}]};
  if(sql.includes('SELECT body FROM public.artae_messages'))
   return {rows:[{body:marker}]};
  throw Error('Unexpected DB query');
 },
 fetch:async(uri,options)=>{
  const url=new URL(uri),path=url.pathname;
  if(path==='/signed-test-video'){
   const range=options.headers?.Range;
   events.push({path,range});
   if(range){
    const body=new Uint8Array([65,66]);
    return new Response(body,{status:206,headers:{
     'Content-Range':'bytes 0-1/9000000','Content-Length':'2',
     'Accept-Ranges':'bytes'
    }});
   }
   return new Response(new Uint8Array([65,66,67]),{status:200,headers:{
    'Content-Length':'3','Accept-Ranges':'bytes'
   }});
  }
  assert.equal(options.headers.Authorization,'OAuth test-only-secret');
  events.push({path});
  if(path==='/v1/disk/resources')
   return Response.json({type:'file',size:9000000});
  if(path==='/v1/disk/resources/download')
   return Response.json({href:'https://downloader.disk.yandex.ru/signed-test-video'});
  throw Error('Unexpected fetch '+path);
 },
};
const source=api.replace(/^import .*;\r?\n/gm,'')
 .replace('export default async function handler(request){','async function handler(request){')+
 '\n;globalThis.execute=handler;';
runInNewContext(source,mock,{filename:'files-explorer.mjs'});
function mediaRequest(method='GET',range=null){
 const query=new URLSearchParams({
  action:'chatMedia',project:ids.project,convo:ids.convo,
  fileId:ids.file,messageId:ids.message,name:'clip.mp4'
 });
 return new Request(origin+'/.netlify/functions/files-explorer?'+query,{
  method,headers:range?{Range:range}:{}
 });
}
let res=await mock.execute(mediaRequest('HEAD'));
assert.equal(res.status,200);
assert.equal(res.headers.get('content-length'),'9000000');
assert.equal(res.headers.get('accept-ranges'),'bytes');
assert.equal(res.headers.get('content-type'),'video/mp4');
assert.equal(res.body,null,'HEAD must not transfer video bytes');
assert.equal(events.filter(x=>x.path==='/signed-test-video').length,0);

res=await mock.execute(mediaRequest('GET','bytes=0-1'));
assert.equal(res.status,206);
assert.equal(res.headers.get('content-type'),'video/mp4');
assert.equal(res.headers.get('content-range'),'bytes 0-1/9000000');
assert.equal(res.headers.get('content-length'),'2');
assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[65,66]);
assert.ok(events.some(e=>e.path==='/signed-test-video'&&e.range==='bytes=0-1'));

res=await mock.execute(mediaRequest());
assert.equal(res.status,200);
assert.equal(res.headers.get('content-length'),'3');
assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[65,66,67]);

res=await mock.execute(mediaRequest('GET','bytes=0-1,3-5'));
assert.equal(res.status,416);
allow=false;
res=await mock.execute(mediaRequest('HEAD'));
assert.equal(res.status,401);
allow=true;
console.log('MOBILE_VIDEO_RANGE_OK head=true exact_206_bytes=true preserves_content_length=true auth=true codec_fallback=true');
