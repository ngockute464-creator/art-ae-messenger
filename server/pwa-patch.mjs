// ART-AE PWA packaging: a deterministic build id and a scoped, network-first shell.
// The original release ZIP remains unchanged. Only the generated public assets change.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const gitBuild=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(gitBuild))throw Error('PWA: no verified Git build SHA');
const buildId=gitBuild; // The release manager and GitHub Actions both use pinned Git checkouts.
const version='0.4.6-preview';

const indexPath='public/index.html';
let html=readFileSync(indexPath,'utf8');
if(!html.includes('href="manifest.webmanifest"')||!html.includes('</body>')||!html.includes('</head>'))
 throw Error('PWA: unexpected application HTML');
html=html.replace('</head>',
 '<meta name="apple-mobile-web-app-capable" content="yes">'+
 '<meta name="apple-mobile-web-app-status-bar-style" content="default">'+
 '<meta name="application-name" content="АРТ-АЕ">'+
 '<meta name="artae-build" content="'+buildId+'">'+
 '<meta name="artae-version" content="'+version+'"></head>');
html=html.replace('</body>','<script src="pwa-client.js" defer></script></body>');
writeFileSync(indexPath,html);
writeFileSync('public/app-version.json',JSON.stringify({version,build:buildId,branch:'netlify-preview'}));
copyFileSync('server/pwa-client.js','public/pwa-client.js');

const appPath='public/app.js';
let app=readFileSync(appPath,'utf8');
const profile='<button type="button" role="menuitem" data-act="editProfile">Мой профиль</button>';
if(!app.includes(profile))throw Error('PWA: profile menu template changed');
app=app.replace(profile,profile+'<button type="button" role="menuitem" data-act="appInstallInfo">Приложение</button>');
writeFileSync(appPath,app);

const manifestPath='public/manifest.webmanifest';
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
manifest.description='Мессенджер проектов АРТ-АЕ';
manifest.display='standalone';
manifest.start_url='./';
manifest.scope='./';
manifest.lang='ru';
writeFileSync(manifestPath,JSON.stringify(manifest));

// Do not cache private API responses, files or the bundled Office editor.
// HTML must be fetched from the network whenever available. Only ARТ-AE
// caches may be removed at activation; never touch other origin caches.
const oldWorker=readFileSync('public/sw.js','utf8');
if(!oldWorker.includes("self.addEventListener('fetch'")||
   !oldWorker.includes("self.addEventListener('install'"))throw Error('PWA: unexpected existing service worker');
const sw=String.raw`const CACHE='art-ae-release-__BUILD__';
const FILES=['./','./index.html','./styles.css','./app.js','./auth.js','./auth.css','./manifest.webmanifest','./icon.svg','./pwa-client.js','./office-client.js','./vendor/pdfjs/pdf.mjs','./vendor/pdfjs/pdf.worker.mjs'];
const PATHS=new Set(FILES.map(p=>new URL(p,self.registration.scope).pathname));
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  // Never allow one missing offline asset or a CacheStorage error to leave the
  // PWA in the "installing" state indefinitely. Cache each asset independently.
  try{
   const cache=await caches.open(CACHE);
   const result=await Promise.allSettled(FILES.map(async file=>{
    const request=new Request(new URL(file,self.registration.scope),{cache:'reload'});
    const response=await fetch(request);
    if(!response.ok)throw Error(file+': HTTP '+response.status);
    await cache.put(request,response);
   }));
   for(let i=0;i<result.length;i++){
    if(result[i].status==='rejected')
     console.warn('[ART-AE SW] Failed to precache '+FILES[i],result[i].reason);
   }
  }catch(error){console.warn('[ART-AE SW] Precache unavailable',error)}
  // Keep SW available for Push even if offline caching is partially unavailable.
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('art-ae-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 const path=url.pathname;
 if(path==='/app-version.json'||path.startsWith('/.netlify/functions/')||
    path.startsWith('/office/')||path.startsWith('/api/'))return;
 if(req.mode==='navigate'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(req,{cache:'no-store'});
    if(response.ok&&(path==='/'||path==='/index.html')){
     const cache=await caches.open(CACHE);
     await cache.put(new URL('./index.html',self.registration.scope),response.clone());
    }
    return response;
   }catch{
    const cache=await caches.open(CACHE);
    return await cache.match(new URL('./index.html',self.registration.scope))||Response.error();
   }
  })());
  return;
 }
 if(!PATHS.has(path))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const response=await fetch(req,{cache:'no-store'});
   if(response.ok)await cache.put(new URL(path,self.location.origin),response.clone());
   return response;
  }catch{
   return await cache.match(new URL(path,self.location.origin))||Response.error();
  }
 })());
});
`.replace('__BUILD__',buildId.slice(0,16));
writeFileSync('public/sw.js',sw);
console.log('ART-AE: deterministic PWA release '+buildId.slice(0,12)+'; network-first shell, safe auto-update');
