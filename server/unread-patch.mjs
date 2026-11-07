// Build-time extension: keep the original archived app untouched.
import {readFileSync,writeFileSync} from 'node:fs';
const path='public/app.js';
let app=readFileSync(path,'utf8');
const anchor='function cp(){';
if(!app.includes(anchor))throw Error('Unread patch: app anchor changed');
app=app.replace(anchor,readFileSync('server/unread-client.js','utf8')+'\n'+anchor);
writeFileSync(path,app);
const cssPath='public/styles.css';
let css=readFileSync(cssPath,'utf8');
css+='\n/* ART-AE message totals and unread badges */\n'+
'.artae-message-counts{display:inline-flex;align-items:center;gap:5px;margin-inline-start:auto;flex-shrink:0;vertical-align:middle;padding-inline-start:5px}\n'+
'.artae-total{font-size:11px;color:#8b93a3;font-weight:400;font-variant-numeric:tabular-nums}\n'+
'.artae-unread{font:600 11px/1.6 system-ui,sans-serif;min-width:18px;padding:1px 5px;text-align:center;border-radius:12px;background:#c43649;color:white;font-variant-numeric:tabular-nums}\n';
writeFileSync(cssPath,css);
console.log('ART-AE: message count and read-on-visible client');
