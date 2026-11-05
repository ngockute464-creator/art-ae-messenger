// PWA integration for preview; keeps the existing service worker and application shell.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const indexPath='public/index.html';
let html=readFileSync(indexPath,'utf8');
if(!html.includes('href="manifest.webmanifest"'))throw Error('PWA: missing existing manifest');
if(!html.includes('</body>'))throw Error('PWA: missing body close');
html=html.replace('</head>','<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="application-name" content="АРТ-АЕ"><meta name="artae-build" content="'+String(process.env.COMMIT_REF||'preview').replace(/[^A-Za-z0-9_-]/g,'').slice(0,12)+'"></head>');
html=html.replace('</head>','<meta name="artae-version" content="0.2.8-preview"></head>');
html=html.replace('</body>','<script src="pwa-client.js" defer></script></body>');
writeFileSync(indexPath,html);
const buildId=String(process.env.COMMIT_REF||'preview').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40);
writeFileSync('public/app-version.json',JSON.stringify({version:'0.2.8-preview',build:buildId,branch:'netlify-preview'}));

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

const swPath='public/sw.js';
let sw=readFileSync(swPath,'utf8');
const nextCache='art-ae-preview-'+String(process.env.COMMIT_REF||Date.now()).replace(/[^A-Za-z0-9_-]/g,'').slice(0,18);
if(!/const CACHE='[^']+';/.test(sw))throw Error('PWA: unexpected service worker');
sw=sw.replace(/const CACHE='[^']+';/,"const CACHE='"+nextCache+"';");
if(!sw.includes("'./pwa-client.js'")) {
 if(!sw.includes("'./icon.svg'"))throw Error('PWA: unexpected precache list');
 sw=sw.replace("'./icon.svg'","'./icon.svg','./pwa-client.js'");
}
// Cache the shell immediately on repeat launches. Server data and documents
// continue to bypass the service worker's cache as before.
const networkFirst="e.respondWith(fetch(e.request).then(r=>{if(r.ok){let clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone))}return r}).catch(()=>caches.match(e.request)))";
const offlineFirst="if(['/','/index.html','/auth.js','/auth.css','/manifest.webmanifest','/icon.svg'].includes(path)){e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));return}"+networkFirst;
if(!sw.includes(networkFirst))throw Error('PWA: existing fetch strategy changed');
sw=sw.replace(networkFirst,offlineFirst);
writeFileSync(swPath,sw);
console.log('ART-AE: installable PWA shell, profile status and versioned offline resources');
