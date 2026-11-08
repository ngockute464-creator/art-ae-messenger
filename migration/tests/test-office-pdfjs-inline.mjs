// Regression: DOCX and XLSX preview must NOT delegate PDF rendering to
// Android's external application selector or the browser's native <object>.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const renderer=readFileSync('server/pdf-viewer-client.js','utf8');
const explorer=readFileSync('server/files-client.js','utf8');
const app=readFileSync('public/app.js','utf8');
const version=readFileSync('public/app-version.json','utf8');
assert.match(renderer,/window\.ARTAE_PDF_RENDER=explorerPdfDocumentViewer/);
assert.match(app,/window\.ARTAE_PDF_RENDER=explorerPdfDocumentViewer/);
assert.match(app,/artaeOfficePdfHost/);
assert.match(explorer,/window\.ARTAE_OFFICE_PREVIEW\(path,name,explorer\.project\|\|project\)/);
assert.match(version,/"version":"0\.4\.10-preview"/);

for(const path of ['server/office-client.js','office-site/integration/office-client.js']){
 const code=readFileSync(path,'utf8');
 assert.match(code,/mode==='edit'&&!localFile/,'Only edit mode may acquire a lease');
 assert.match(code,/window\.ARTAE_OFFICE_PREVIEW=\(path,name,projectId\)=>openProjectDocument\(path,name,projectId,null,'preview'\)/);
 assert.match(code,/window\.ARTAE_PDF_RENDER/);
 assert.match(code,/renderPdf\(host,ctx\.pdfUrl,host\)/);
 assert.match(code,/disposeOfficePdf\(a\)/);
 assert.match(code,/disposeOfficePdf\(ctx\)/);
 assert.match(code,/ctx\.pdfHost\.dispatchEvent\(new Event\('close'\)\)/);
 assert.doesNotMatch(code,/document\.createElement\('object'\)/);
 assert.doesNotMatch(code,/window\.open\(/);
 assert.match(code,/aria-label','Просмотр '\+name/);
 assert.match(code,/download\.download=name\.replace\(\/\\\.\(docx\|xlsx\)\$\/i,'\.pdf'\)/);
 assert.match(code,/active\?\.mode==='preview'\)close\(\)/);

 class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.listeners={};
   this.parentElement=null;this.style={};this.textContent='';this.className='';
   this.focused=false;this.removed=false;
  }
  setAttribute(k,v){this.attributes[k]=v}
  append(...items){for(const item of items){this.children.push(item);item.parentElement=this}}
  addEventListener(type,fn){this.listeners[type]=fn}
  dispatchEvent(event){this.listeners[event.type]?.(event)}
  remove(){this.removed=true;
   if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);
  }
  focus(){this.focused=true}
 }
 const parent=new Element('section'),frame=new Element('iframe');parent.append(frame);
 const document={createElement:type=>new Element(type)};
 const revoked=[],urlapi={createObjectURL(){return 'blob:artae-document-123'},
  revokeObjectURL(uri){revoked.push(uri)}};
 const state={textContent:''};
 const closeButton=new Element('button');
 const name='Реальный тест.xlsx';
 const calls=[];
 const window={ARTAE_PDF_RENDER:(host,url,closeSignal)=>{
  calls.push({host,url,closeSignal});
  host.addEventListener('close',()=>{calls.push({closed:true})});
  return Promise.resolve();
 }};
 const ctx={mode:'preview',pdfHost:null,pdfUrl:null};
 const blob=new Blob(['%PDF-1.7\nbinary'],{type:'application/pdf'});
 const beg=code.indexOf("  else if(msg.type==='artae-office-pdf'&&ctx.mode==='preview'){");
 const end=code.indexOf("  else if(msg.type==='artae-office-close-result'){",beg);
 assert.ok(beg>0&&end>beg,path+' PDF message branch not found');
 const branch=code.slice(beg,end).replace(/^\s*else if/,'if');
 const trigger=new Function('msg','ctx','frame','state','closeButton','active',
  'window','document','URL','Blob','name',branch);
 trigger({type:'artae-office-pdf',blob},ctx,frame,state,closeButton,
  ctx,window,document,urlapi,Blob,name);
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(calls.length,1,path+' must use one internal PDF.js renderer');
 assert.equal(calls[0].url,'blob:artae-document-123');
 assert.equal(calls[0].host,ctx.pdfHost);
 assert.equal(calls[0].closeSignal,ctx.pdfHost);
 assert.equal(frame.style.display,'none');
 assert.equal(ctx.pdfHost.attributes.role,'region');
 assert.equal(ctx.pdfHost.children[0].children[0].download,'Реальный тест.pdf');
 assert.match(state.textContent,/PDF открыт в АРТ-АЕ/);
 assert.equal(closeButton.focused,true);
 trigger({type:'artae-office-pdf',blob},ctx,frame,state,closeButton,
  ctx,window,document,urlapi,Blob,name);
 assert.equal(calls.length,1,'Duplicate PDF conversion must not start another viewer');
 const helperBeg=code.indexOf('function disposeOfficePdf(ctx){');
 const helperEnd=code.indexOf('\nfunction close(){',helperBeg);
 assert.ok(helperBeg>0&&helperEnd>helperBeg);
 const helper=code.slice(helperBeg,helperEnd);
 const dispose=new Function('URL','Event',helper+';return disposeOfficePdf')(
  urlapi,Event);
 dispose(ctx);
 assert.equal(ctx.pdfHost,null);
 assert.equal(ctx.pdfUrl,null);
 assert.equal(revoked.length,1);
 assert.equal(calls[1].closed,true,'Closing Office must stop PDF.js rendering');
 assert.equal(parent.children.length,1,'Office PDF panel must be removed');

 const bad={mode:'preview',pdfHost:null,pdfUrl:null};
 trigger({type:'artae-office-pdf',blob:new Blob([],{type:'application/pdf'})},
  bad,frame,state,closeButton,bad,window,document,urlapi,Blob,name);
 assert.equal(bad.pdfHost,null,'Empty exported PDF must not be rendered');
 console.log('OFFICE_PDFJS_INLINE_OK client='+path+' no_external=true pdfjs=true cleanup=true editing_preserved=true');
}
