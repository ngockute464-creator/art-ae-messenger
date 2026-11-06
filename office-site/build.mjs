// Separate static site: use Netlify package directory office-site.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,existsSync,cpSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const parent=process.env.ARTAE_PARENT_ORIGIN;
if(!parent||new URL(parent).origin!==parent||new URL(parent).protocol!=='https:')throw Error('Set exact ARTAE_PARENT_ORIGIN HTTPS origin');
const pin='2ee1000584945e69ee872cbd21ab2f8bd7a80d8d';
const tmp=mkdtempSync(join(tmpdir(),'artae-isolated-office-')),repo=join(tmp,'VibeOffice'),out='office-site/dist';
try{
 execFileSync('git',['clone','--no-checkout','--filter=blob:none','https://github.com/tcchen2026/VibeOffice.git',repo],{stdio:'pipe',timeout:120000});
 execFileSync('git',['fetch','--depth','1','origin',pin],{cwd:repo,timeout:120000});
 execFileSync('git',['checkout','--detach',pin],{cwd:repo,timeout:120000});
 const source=join(repo,'public');
 for(const p of ['quire/index.html','ledger/index.html','common/core.js'])if(!existsSync(join(source,p)))throw Error('Missing '+p);
 rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});cpSync(source,out,{recursive:true});
 const printer=join(out,'ledger/js/print.js');let code=readFileSync(printer,'utf8');
 const anchor='      ui.busy(false);\n      const name = (A.books[A.cur]';
 if(!code.includes(anchor))throw Error('Ledger PDF API changed');
 code=code.replace(anchor,'      ui.busy(false);\n      if (opts.returnBlob) return pdf;\n      const name = (A.books[A.cur]');
 writeFileSync(printer,code);
 let bridge=readFileSync('office-site/integration/office-frame.js','utf8');
 if(!bridge.includes('__ARTAE_PARENT_ORIGIN__'))throw Error('Bridge placeholder missing');
 bridge=bridge.replace('__ARTAE_PARENT_ORIGIN__',JSON.stringify(parent));
 writeFileSync(join(out,'artae-bridge.js'),bridge);
 for(const kind of ['quire','ledger']){
  const p=join(out,kind,'index.html');let html=readFileSync(p,'utf8');
  const anchor=html.match(/<\/body\s*>/i)?.[0]||html.match(/<\/html\s*>/i)?.[0];
  if(!anchor)throw Error('Missing HTML anchor');
  html=html.replace(anchor,'<script src="../artae-bridge.js" defer></script>\n'+anchor);
  writeFileSync(p,html);
 }
 rmSync(join(out,'sw.js'),{force:true});
 writeFileSync(join(out,'_headers'),'/*\n  Content-Security-Policy: frame-ancestors '+parent+'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n');
 console.log('Isolated Office bundle prepared for',parent);
}finally{rmSync(tmp,{recursive:true,force:true})}
