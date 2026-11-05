// Build-time overlay: ZIP remains the unchanged user release format.
// Keep server code independently editable in GitHub.
import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
copyFileSync('server/sync-pg.mjs','netlify/functions/sync.mjs');
const file='public/app.js';
let app=readFileSync(file,'utf8');
const old='setInterval(()=>{if(!document.hidden&&syncReady)syncMessages()},15000);';
if(!app.includes(old))throw Error('Unexpected app.js version: polling timer not found');
app=app.replace(old,'setInterval(()=>{if(!document.hidden&&syncReady)syncMessages()},5000);');
writeFileSync(file,app);
const sw='public/sw.js';
let worker=readFileSync(sw,'utf8').replace('art-ae-shared-text-v1','art-ae-postgres-v1');
writeFileSync(sw,worker);
console.log('PostgreSQL adapter enabled; foreground sync interval 5s');
