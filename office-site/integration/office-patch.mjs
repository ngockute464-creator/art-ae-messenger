// Enable isolated Office only after the second Netlify site passes browser QA.
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const value=process.env.ARTAE_OFFICE_ORIGIN||'';
if(value){const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value)throw Error('ARTAE_OFFICE_ORIGIN must be exact HTTPS origin')}
writeFileSync('public/office-config.js','window.ARTAE_OFFICE_ORIGIN='+JSON.stringify(value)+';');
const index='public/index.html';
let html=readFileSync(index,'utf8');
if(!html.includes('</body>')||!html.includes('</head>'))throw Error('Office: index changed');
html=html.replace('</head>','<script src="office-config.js"></script></head>');
html=html.replace('</body>','<script src="office-client.js" defer></script></body>');
writeFileSync(index,html);
copyFileSync('office-site/integration/office-client.js','public/office-client.js');
const app=readFileSync('public/app.js','utf8');
if(!app.includes('window.__ARTAE_OFFICE_READY__'))throw Error('Office handler not bundled');
new Function(app);
const swFile='public/sw.js';
let sw=readFileSync(swFile,'utf8');
sw=sw.replace("'./pwa-client.js'","'./pwa-client.js','./office-client.js'");
writeFileSync(swFile,sw);
console.log('ART-AE: isolated Office configured; no /office files on main origin');
