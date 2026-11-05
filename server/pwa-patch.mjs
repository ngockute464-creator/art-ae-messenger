// PWA integration for preview; keeps the existing service worker and application shell.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const indexPath='public/index.html';
let html=readFileSync(indexPath,'utf8');
if(!html.includes('href="manifest.webmanifest"'))throw Error('PWA: missing existing manifest');
if(!html.includes('</body>'))throw Error('PWA: missing body close');
html=html.replace('</head>','<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="application-name" content="АРТ-АЕ"><meta name="artae-build" content="'+String(process.env.COMMIT_REF||'preview').replace(/[^A-Za-z0-9_-]/g,'').slice(0,12)+'"></head>');
html=html.replace('</body>','<script src="pwa-client.js" defer></script></body>');
writeFileSync(indexPath,html);
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
writeFileSync(swPath,sw);
console.log('ART-AE: installable PWA shell, profile status and versioned offline resources');
