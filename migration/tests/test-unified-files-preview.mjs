import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const chat=readFileSync('server/chat-media-client.js','utf8');
const explorer=readFileSync('server/files-client.js','utf8');
const pdfViewer=readFileSync('server/pdf-viewer-client.js','utf8');
const api=readFileSync('migration/runtime/files-explorer.mjs','utf8');
const bridge=readFileSync('migration/runtime/http-server.mjs','utf8');
const build=readFileSync('build/prepare.mjs','utf8');
const worker=readFileSync('public/sw.js','utf8');
const app=readFileSync('public/app.js','utf8');
const css=readFileSync('public/styles.css','utf8');
assert.match(chat,/data-chat-name=".+esc\(file.name\)/);
assert.ok(!chat.includes('chatMediaCaptionName'));
assert.ok(!chat.includes('chatMediaCaptionSize'));
assert.match(app,/function explorerFileTypeIcon\(name,mime=/);
assert.match(app,/function explorerPdfDocumentViewer\(/);
assert.match(explorer,/fileViewerDownload/);
assert.match(explorer,/action:'chatMediaDownload'/);
assert.match(explorer,/action:'projectMediaDownload'/);
assert.match(explorer,/await explorerPdfDocumentViewer\(body,signedUrl,dialog\)/);
assert.match(explorer,/kind==='video'\|\|kind==='pdf'/);
assert.match(pdfViewer,/import\('\/vendor\/pdfjs\/pdf\.mjs'\)/);
assert.match(pdfViewer,/pdf\.worker\.mjs/);
assert.match(pdfViewer,/rangeChunkSize:131072/);
assert.match(pdfViewer,/await documentHandle\.getPage\(page\)/);
assert.match(pdfViewer,/await pdfPage\.getTextContent\(\)/);
assert.match(pdfViewer,/Math\.sqrt\(10000000\/Math\.max/);
assert.match(api,/pdf:'application\/pdf'/);
assert.match(api,/projectMediaDownload/);
assert.match(api,/chatMediaDownload/);
assert.match(bridge,/projectMediaDownload/);
assert.match(worker,/vendor\/pdfjs\/pdf\.mjs/);
assert.match(worker,/vendor\/pdfjs\/pdf\.worker\.mjs/);
assert.match(build,/vendor-pdfjs\.mjs/);
assert.match(css,/\.artaePdfViewport/);
assert.match(css,/\.projectFileTypeIcon/);
for(const file of ['public/vendor/pdfjs/pdf.mjs','public/vendor/pdfjs/pdf.worker.mjs']){
 assert.ok(statSync(file).size>350000,file+' must be vendored locally at build time');
}
const e=explorer.slice(explorer.indexOf('function explorerFileTypeIcon('),explorer.indexOf('function filesView(){'));
const sandbox={explorerKind(name){
 const ext=(name.split('.').pop()||'').toLowerCase();
 if(['jpg','png'].includes(ext))return 'image';
 if(['mp4','mov'].includes(ext))return 'video';
 if(['md','txt'].includes(ext))return 'text';
 return 'unknown';
}};
runInNewContext(e+'\n;globalThis.icon=explorerFileTypeIcon;',sandbox);
for(const [name,expect] of [
 ['photo.jpg','image'],['movie.mp4','video'],
 ['work.docx','word'],['sheet.xlsx','excel'],['contract.pdf','pdf'],
 ['slides.pptx','slides'],['README.md','markdown'],['notes.txt','text'],
 ['unknown.zip','file']]){
 assert.match(sandbox.icon(name),new RegExp('projectFileTypeIcon-'+expect+'\\b'));
}

// Fake both private chat and project file original downloads without any
// network access, preserving Content-Disposition and response byte ranges.
const project='11111111-1111-4111-8111-111111111111';
const convo='22222222-2222-4222-8222-222222222222';
const fileId='33333333-3333-4333-8333-333333333333';
const message='44444444-4444-4444-8444-444444444444';
const name='Фотография.jpg';
const marker='[[chatfile:v1:'+fileId+':'+encodeURIComponent(name)+':3]]';
let loggedIn=true,markerBody=marker;
const calls=[];
const fake={
 URL,Request,Response,Headers,AbortSignal,Uint8Array,console,
 process:{env:{YANDEX_DISK_TOKEN:'TEST_TOKEN'}},
 getSession:async()=>loggedIn?{user:{id:project}}:null,
 query:async(q)=>{
  if(q.includes('FROM public.artae_projects'))return {rows:[{id:project,folder_path:'app:/Project',name:'Project'}]};
  if(q.includes('FROM public.artae_conversations'))return {rows:[{id:convo}]};
  if(q.includes('SELECT body FROM public.artae_messages'))return {rows:[{body:markerBody}]};
  throw Error('Unexpected query '+q);
 },
 fetch:async(href,opts)=>{
  const u=new URL(href);
  calls.push({path:u.pathname,range:opts.headers?.Range,search:u.searchParams});
  if(u.pathname==='/v1/disk/resources')return Response.json({type:'file',size:3});
  if(u.pathname==='/v1/disk/resources/download')
   return Response.json({href:'https://downloader.disk.yandex.ru/original-test'});
  if(u.pathname==='/original-test'){
   if(opts.headers?.Range)
    return new Response(new Uint8Array([1,2]),{status:206,headers:{
     'Content-Range':'bytes 0-1/3','Content-Length':'2','Accept-Ranges':'bytes'
    }});
   return new Response(new Uint8Array([1,2,3]),{status:200,headers:{
    'Content-Length':'3','Accept-Ranges':'bytes'
   }});
  }
  throw Error('Unexpected disk URL '+u);
 }
};
const runtime=api.replace(/^import .*;\r?\n/gm,'')
 .replace('export default async function handler(request){','async function handler(request){')+
 '\n;globalThis.call=handler;';
runInNewContext(runtime,fake);
const url=(action,extra={})=>
 'https://artae.example/.netlify/functions/files-explorer?'+new URLSearchParams({
  action,project,path:'Photos/'+name,
  convo,fileId,name,messageId:message,...extra
 });
let r=await fake.call(new Request(url('projectMediaDownload')));
assert.equal(r.status,200);
assert.match(r.headers.get('content-disposition'),/^attachment; filename\*=UTF-8''/);
assert.equal(r.headers.get('content-type'),'application/octet-stream');
assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2,3]);
r=await fake.call(new Request(url('projectMediaDownload'),{headers:{Range:'bytes=0-1'}}));
assert.equal(r.status,206);
assert.equal(r.headers.get('content-range'),'bytes 0-1/3');
assert.equal(r.headers.get('content-length'),'2');
assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[1,2]);
r=await fake.call(new Request(url('chatMediaDownload')));
assert.equal(r.status,200);
assert.match(r.headers.get('content-disposition'),/^attachment/);
markerBody='not your attachment';
assert.equal((await fake.call(new Request(url('chatMediaDownload')))).status,403);
markerBody=marker;
loggedIn=false;
assert.equal((await fake.call(new Request(url('projectMediaDownload')))).status,401);
loggedIn=true;
assert.equal((await fake.call(new Request(url('projectMediaDownload',{path:'../escape.jpg'})))).status,400);
console.log('UNIFIED_FILES_PREVIEW_OK thumbnails=true icons=9 pdfjs_local=true downloads=true ranges=true auth=true');
