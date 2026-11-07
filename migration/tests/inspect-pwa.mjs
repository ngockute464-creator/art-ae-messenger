import {readFileSync} from 'node:fs';
const sw=readFileSync('public/sw.js','utf8');
const html=readFileSync('public/index.html','utf8');
console.log('ARTAE_BASE_SERVICE_WORKER',JSON.stringify(sw));
console.log('ARTAE_SERVICE_WORKER_REGISTRATION',JSON.stringify((html.match(/.{0,200}serviceWorker.{0,500}/gs)||[]).slice(0,4)));
console.log('ARTAE_APP_JS_SW',JSON.stringify((readFileSync('public/app.js','utf8').match(/.{0,140}serviceWorker.{0,240}/gs)||[]).slice(0,10)));
