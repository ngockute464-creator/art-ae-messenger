import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const api=readFileSync('migration/runtime/files-explorer.mjs','utf8');
const client=readFileSync('server/chat-media-client.js','utf8');
const explorer=readFileSync('server/files-client.js','utf8');
const chat=readFileSync('server/chat-file-client.js','utf8');
const generated=readFileSync('public/app.js','utf8');
const styles=readFileSync('public/styles.css','utf8');
assert.match(generated,/chatMediaHtml\(f,m\)/);
assert.match(generated,/chatMediaCopyPicker/);
assert.match(styles,/\.chatMediaVisual img,\.chatMediaVisual video\{[^}]*object-fit:contain/);
assert.match(explorer,/async function explorerPreview\(path,name,mime,chatSource=null,opener=null\)/);
assert.match(explorer,/media\.src=signedUrl\|\|objectUrl/);
assert.match(explorer,/save\.textContent='В файлы проекта'/);
assert.match(api,/\/resources\/copy/);
assert.match(api,/overwrite:'false'/);
assert.match(api,/requireChatAttachmentMessage/);
assert.match(api,/\['chatMedia','chatMediaDownload'\]\.includes\(args.action\)/);
assert.match(api,/new Response\(upstream.body/);
assert.match(explorer,/signedUrl=chatMediaStreamUrl\(chatSource\)/);
assert.match(client,/media.src=button.dataset.chatKind==='video'/);
assert.ok(!client.includes('const href=await chatMediaLink(source)'));

assert.ok(!client.includes('canvas.toDataURL')&&!client.includes('drawImage('));
assert.match(client,/IntersectionObserver/);
assert.match(client,/new MutationObserver/);
assert.match(client,/preload="metadata"/);
// Rendering old and new messages must distinguish media from other attachments.
const sandbox={
 console,URL,URLSearchParams,Map,Set,Date,Promise,queueMicrotask:()=>{},
 root:{querySelectorAll:()=>[],addEventListener(){}},
 explorerKind(name){return /\.png$/i.test(name)?'image':/\.mp4$/i.test(name)?'video':'unknown'},
 esc(value){return String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')},
 document:{createElement(){}},window:{},setTimeout,clearTimeout,
};
runInNewContext(client+';globalThis.makeMedia=chatMediaHtml;',sandbox);
const f={id:'66666666-6666-4666-8666-666666666666',size:9999999,name:'photo.png'};
const message={convo:'55555555-5555-4555-8555-555555555555',id:'77777777-7777-4777-8777-777777777777'};
sandbox.project='11111111-1111-4111-8111-111111111111';
assert.match(sandbox.makeMedia(f,message),/<img alt="" loading="lazy">/);
assert.match(sandbox.makeMedia({...f,name:'movie.mp4'},message),/<video muted playsinline preload="metadata"/);
assert.equal(sandbox.makeMedia({...f,name:'notes.txt'},message),'');
assert.doesNotMatch(sandbox.makeMedia({...f,name:'a"b.png'},message),/data-chat-name="a"b\.png"/);
const uri=sandbox.chatMediaStreamUrl({project:sandbox.project,convo:message.convo,fileId:f.id,name:f.name,messageId:message.id});
assert.ok(String(uri).startsWith('/.netlify/functions/files-explorer?action=chatMedia&'));
assert.ok(!String(uri).includes('https://downloader.'));


// Execute actual API code with its network boundary mocked. No live Disk or DB.
const UUIDS={
 project:'11111111-1111-4111-8111-111111111111',
 convo:'22222222-2222-4222-8222-222222222222',
 file:'33333333-3333-4333-8333-333333333333',
 message:'44444444-4444-4444-8444-444444444444'
};
const marker='[[chatfile:v1:'+UUIDS.file+':clip.mp4:9000000]]';
const validOrigin='https://artae.example';
let markerText=marker,sessionEnabled=true,copyCollision=false;
const calls=[];
const apiSource=api.replace(/^import .*;\r?\n/gm,'')
 .replace('export default async function handler(request){','async function handler(request){')+
 '\n;globalThis.handle=handler;';
const mocks={
 URL,Request,Response,Headers,AbortSignal,Uint8Array,TextDecoder,TextEncoder,console,
 setTimeout,clearTimeout,randomUUID:()=>UUIDS.file,
 process:{env:{YANDEX_DISK_TOKEN:'test-only-secret',ARTAE_NEXT_ALLOW_DISK_WRITES:'1'}},
 getSession:async()=>sessionEnabled?{user:{id:UUIDS.project,name:'Tester'}}:null,
 query:async(sql,params)=>{
  if(sql.includes('FROM public.artae_projects'))return {rows:[{
   id:UUIDS.project,name:'Example',folder_path:'app:/Example'}]};
  if(sql.includes('FROM public.artae_conversations'))
   return {rows:params[0]===UUIDS.convo?[{id:UUIDS.convo}]:[]};
  if(sql.includes('SELECT body FROM public.artae_messages'))
   return {rows:params[0]===UUIDS.message?[{body:markerText}]:[]};
  throw Error('Unexpected query '+sql);
 },
 fetch:async(uri,opts)=>{
  const url=new URL(uri);
  if(url.pathname==='/signed-example'){
   const content=new TextEncoder().encode('ORIGINAL-FILE-1234567890');
   const range=opts.headers?.Range;
   calls.push({method:opts.method,path:url.pathname,range});
   return new Response(content,{status:range?206:200,headers:{
    'Content-Type':'application/octet-stream',
    'Content-Range':'bytes 0-23/9000000','Accept-Ranges':'bytes'
   }});
  }
  assert.equal(opts.headers.Authorization,'OAuth test-only-secret');
  const endpoint=url.pathname;calls.push({method:opts.method,path:endpoint,params:url.searchParams});
  let status=200,value={};
  if(endpoint==='/v1/disk/resources'&&opts.method==='GET'){
   const item=url.searchParams.get('path');
   value={type:item==='app:/Example/photos'||item==='app:/Example'?'dir':'file',size:9000000};
  }else if(endpoint==='/v1/disk/resources/copy'&&opts.method==='POST'){
   if(copyCollision){status=409;value={error:'already exists'}}
   else{status=202;value={href:'https://cloud-api.yandex.net/v1/disk/operations/COPY_12345'}}
  }else if(endpoint==='/v1/disk/operations/COPY_12345'){
   value={status:'success'};
  }else if(endpoint==='/v1/disk/resources/download'){
   value={href:'https://downloader.disk.yandex.ru/signed-example'};
  }else{
   throw Error('Unexpected Disk request '+endpoint+' '+opts.method);
  }
  return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
 }
};
runInNewContext(apiSource,mocks,{filename:'files-explorer-mock.mjs'});
const invoke=async(action,rest={},origin=validOrigin)=>{
 const req=new Request(validOrigin+'/.netlify/functions/files-explorer',{
  method:'POST',headers:{origin,'Content-Type':'application/json'},
  body:JSON.stringify({action,project:UUIDS.project,convo:UUIDS.convo,
   fileId:UUIDS.file,name:'clip.mp4',messageId:UUIDS.message,path:'photos',
   targetName:'Копия оригинала.mp4',...rest})
 });
 const response=await mocks.handle(req);
 return {status:response.status,body:await response.json()};
};
const copied=await invoke('chatCopyToProject');
assert.equal(copied.status,202);
assert.equal(copied.body.ok,true);
assert.equal(copied.body.done,false);
assert.equal(copied.body.operationId,'COPY_12345');
assert.equal(copied.body.path,'photos/Копия оригинала.mp4');
const callsCopy=calls.filter(c=>c.path==='/v1/disk/resources/copy');
assert.equal(callsCopy.length,1);
assert.equal(callsCopy[0].params.get('from'),'app:/Example/!ФайлыИзЧатов/'+UUIDS.file+'__clip.mp4');
assert.equal(callsCopy[0].params.get('path'),'app:/Example/photos/Копия оригинала.mp4');
assert.equal(callsCopy[0].params.get('overwrite'),'false');
assert.equal((await invoke('chatCopyStatus',{operationId:'COPY_12345'})).body.done,true);
assert.equal((await invoke('chatCopyToProject',{path:'../secrets'})).status,400);
assert.equal((await invoke('chatCopyToProject',{path:'!ФайлыИзЧатов'})).status,403);
assert.equal((await invoke('chatCopyToProject',{targetName:'../bad.mp4'})).status,400);
assert.equal((await invoke('chatCopyToProject',{messageId:UUIDS.file})).status,404);
assert.equal((await invoke('chatCopyToProject',{convo:UUIDS.file})).status,403);
markerText='some other message';
assert.equal((await invoke('chatCopyToProject')).status,403);
markerText=marker;
copyCollision=true;
assert.equal((await invoke('chatCopyToProject')).status,409);
copyCollision=false;
sessionEnabled=false;
assert.equal((await invoke('chatCopyToProject')).status,401);
sessionEnabled=true;
assert.equal((await invoke('chatCopyToProject',{},'https://evil.example')).status,403);
// The real handler must stream original bytes with correct MIME and range
// semantics, and never accept media URLs without a live session and marker.
const mediaRequest=(name='clip.mp4',range=null,extra={})=>{
 const args=new URLSearchParams({action:'chatMedia',project:UUIDS.project,
  convo:UUIDS.convo,fileId:UUIDS.file,messageId:UUIDS.message,name,...extra});
 return new Request(validOrigin+'/.netlify/functions/files-explorer?'+args,{
  method:'GET',headers:range?{Range:range}:{}
 });
};
let r=await mocks.handle(mediaRequest());
assert.equal(r.status,200);
assert.equal(r.headers.get('content-type'),'video/mp4');
assert.equal(r.headers.get('content-disposition'),'inline');
assert.equal(r.headers.get('cache-control'),'private, no-store');
assert.equal(new TextDecoder().decode(await r.arrayBuffer()),'ORIGINAL-FILE-1234567890');
r=await mocks.handle(mediaRequest('clip.mp4','bytes=0-23'));
assert.equal(r.status,206);
assert.equal(r.headers.get('content-range'),'bytes 0-23/9000000');
assert.equal(new TextDecoder().decode(await r.arrayBuffer()),'ORIGINAL-FILE-1234567890');
assert.ok(calls.some(c=>c.path==='/signed-example'&&c.range==='bytes=0-23'));
assert.equal((await mocks.handle(mediaRequest('clip.mp4','bytes=0-10,20-30'))).status,416);
assert.equal((await mocks.handle(mediaRequest('clip.mp4',null,{messageId:UUIDS.file}))).status,404);
markerText='wrong';
assert.equal((await mocks.handle(mediaRequest())).status,403);
markerText=marker;
sessionEnabled=false;
assert.equal((await mocks.handle(mediaRequest())).status,401);
console.log('CHAT_MEDIA_TEST_OK preview=true media_stream=true byte_range=true access=true copy_no_reencode=true collision=true traversal=true');
