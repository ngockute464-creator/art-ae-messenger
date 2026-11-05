// Standalone VibeOffice pinned bundle + minimal iframe bridge.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,existsSync,cpSync,rmSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const pin='2ee1000584945e69ee872cbd21ab2f8bd7a80d8d';
const temp=mkdtempSync(join(tmpdir(),'artae-office-'));
const editor=join(temp,'VibeOffice');
const run=(...args)=>execFileSync('git',args,{cwd:editor,stdio:'pipe',timeout:120000});
try{
 execFileSync('git',['clone','--no-checkout','--filter=blob:none','https://github.com/tcchen2026/VibeOffice.git',editor],{stdio:'pipe',timeout:120000});
 run('fetch','--depth','1','origin',pin);
 run('checkout','--detach',pin);
 const source=join(editor,'public');
 for(const path of ['index.html','quire/index.html','ledger/index.html','common/core.js']){
  if(!existsSync(join(source,path)))throw Error('VibeOffice is missing '+path);
 }
 cpSync(source,'public/office',{recursive:true});
 const bridge='<script src="../artae-bridge.js" defer></script>';
 for(const kind of ['quire','ledger']){
  const page='public/office/'+kind+'/index.html';
  let html=readFileSync(page,'utf8');
  // Quire ends with </body>, while Ledger deliberately omits that optional tag.
  // Insert after the editor app.js script, before the document end in both cases.
  const anchor=html.match(/<\/body\s*>/i)?.[0]||html.match(/<\/html\s*>/i)?.[0];
  if(!anchor)throw Error('Office bridge: no closing HTML anchor in '+kind);
  html=html.replace(anchor,bridge+'\n'+anchor);
  writeFileSync(page,html);
 }
 copyFileSync('server/office-frame.js','public/office/artae-bridge.js');
 // Upstream service worker is deliberately disabled at this path; ART-AE owns the origin.
 rmSync('public/office/sw.js',{force:true});
} finally {rmSync(temp,{recursive:true,force:true})}
const index='public/index.html';
let html=readFileSync(index,'utf8');
if(!html.includes('</body>'))throw Error('Office: index changed');
html=html.replace('</body>','<script src="office-client.js" defer></script></body>');
writeFileSync(index,html);
copyFileSync('server/office-client.js','public/office-client.js');
// The click handler is injected inside the main app scope by files-patch.mjs.
const appFile='public/app.js';
const merged=readFileSync(appFile,'utf8');
if(!merged.includes('window.__ARTAE_OFFICE_READY__'))throw Error('Office handler not bundled inside app.js');
new Function(merged);
// Client script is lazy by usage; only tiny bridge is loaded at application start.
const swFile='public/sw.js';
let sw=readFileSync(swFile,'utf8');
sw=sw.replace("'./pwa-client.js'","'./pwa-client.js','./office-client.js'");
writeFileSync(swFile,sw);
console.log('ART-AE: bundled pinned VibeOffice /office/ and sandboxed copy-only editing');
