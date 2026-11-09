import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync('server/pdf-viewer-client.js','utf8');
const app=readFileSync('public/app.js','utf8');
const style=readFileSync('public/styles.css','utf8');
const version=readFileSync('public/app-version.json','utf8');
assert.match(code,/const MAX_SCROLL_CANVASES=3/);
assert.match(code,/function pageAtOffset\(y\)/);
assert.match(code,/function releaseScrollCanvas\(number\)/);
assert.match(code,/Math\.sqrt\(4000000\/Math\.max/);
assert.match(code,/modeButton\.setAttribute\('aria-pressed',String\(mode==='scroll'\)\)/);
assert.match(code,/viewport\.addEventListener\('scroll',onScroll,\{passive:true\}\)/);
assert.match(code,/viewport\.removeEventListener\('scroll',onScroll\)/);
assert.match(app,/function explorerPdfDocumentViewer\(/);
assert.match(style,/\.artaePdfViewport\.artaePdfContinuous/);
assert.match(version,/"version":"0\.4\.23-preview"/);

class FakeElement {
 constructor(tag){
  this.tag=tag;this.children=[];this.parent=null;this.style={};this.dataset={};
  this.listeners={};this.className='';this.textContent='';this.value='';
  this.scrollTop=0;this.disabled=false;this.clientWidth=700;this.clientHeight=480;
  this.canvasCount=0;
  const names=new Set();
  this.classList={
   add:name=>names.add(name),
   remove:name=>names.delete(name),
   contains:name=>names.has(name)
  };
 }
 append(...children){
  for(const child of children){
   if(child.isFragment){this.append(...child.children);continue}
   child.parent=this;this.children.push(child);
  }
 }
 replaceChildren(...children){
  for(const c of this.children)c.parent=null;
  this.children=[];this.append(...children);
 }
 remove(){
  if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);
  this.parent=null;
 }
 setAttribute(name,value){this[name]=value}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
 removeEventListener(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(x=>x!==fn)}
 emit(name,props={}){
  for(const fn of [...(this.listeners[name]||[])])fn({target:this,...props});
 }
 click(){this.emit('click')}
 get offsetHeight(){
  return Math.max(1,Number.parseFloat(this.style.height||this.style.minHeight||0)||0);
 }
 get offsetTop(){
  if(!this.parent)return 0;
  let y=0;
  for(const sibling of this.parent.children){
   if(sibling===this)break;
   y+=sibling.offsetHeight;
  }
  return y;
 }
 getBoundingClientRect(){
  if(this===viewport)return {top:0,bottom:this.clientHeight};
  const y=this.offsetTop-(viewport?.scrollTop||0);
  return {top:y,bottom:y+this.offsetHeight};
 }
 getContext(){return this.tag==='canvas'?{}:null}
}
let viewport=null;
const body=new FakeElement('body');
const dialog=new FakeElement('dialog');
let pagesRequested=0,rendered=0,destroyed=0,cancelled=0;
const pdfDoc={
 numPages:7,
 async getPage(index){
  pagesRequested++;
  assert.ok(index>=1&&index<=7);
  return {
   getViewport({scale}){return {width:400*scale,height:600*scale}},
   render({canvas}){
    assert.ok(canvas.width>0&&canvas.height>0);
    rendered++;
    return {promise:Promise.resolve(),cancel(){cancelled++}};
   },
   async getTextContent(){return {items:[{str:'Текст на странице '+index}]}}
  };
 }
};
const task={promise:Promise.resolve(pdfDoc),destroy:async()=>{destroyed++}};
const sandbox={
 document:{
  createElement(tag){
   const el=new FakeElement(tag);
   if(tag==='div'&&!viewport){} // viewport is identified by className after creation
   return el;
  },
  createDocumentFragment(){return {
   isFragment:true,children:[],append(el){this.children.push(el)}
  }}
 },
 window:{devicePixelRatio:1},
 requestAnimationFrame:fn=>queueMicrotask(fn),
 artaeLoadPdfJs:async()=>({getDocument(){return task}}),
 console
};
const part=code.slice(code.indexOf('async function explorerPdfDocumentViewer('));
runInNewContext(part+'\n;globalThis.startViewer=explorerPdfDocumentViewer;',sandbox);
const settle=async(count=30)=>{for(let i=0;i<count;i++)await Promise.resolve()};
await sandbox.startViewer(body,'/.netlify/functions/files-explorer?action=projectMedia',dialog);
const toolbar=body.children[0],status=body.children[1];
viewport=body.children[2];
assert.equal(viewport.children.length,1,'Existing postranch mode stays single-page');
const modeButton=toolbar.children.find(el=>el.className.includes('artaePdfModeButton'));
assert.ok(modeButton);
assert.equal(modeButton.textContent,'Лента');
assert.equal(modeButton['aria-pressed'],'false');

modeButton.click();await settle();
assert.equal(modeButton.textContent,'Страницы');
assert.equal(modeButton['aria-pressed'],'true');
assert.equal(viewport.children.length,7,'All seven pages get only lightweight placeholders');
assert.equal(viewport.children.filter(s=>s.className==='artaePdfSheet').length,7);
assert.equal(viewport.children.filter(s=>s.children.some(c=>c.tag==='canvas')).length<=3,true,
 'No more than 3 rasterized sheets');
assert.equal(pagesRequested<=6,true,'Not all seven PDF pages should be loaded');

const pageBox=toolbar.children.find(el=>el.className==='artaePdfPageNumber');
viewport.scrollTop=viewport.children[4].offsetTop+4;
viewport.emit('scroll');await settle();
assert.equal(Number(pageBox.value),5,'Wheel/touch scroll updates current page');
assert.equal(viewport.children.filter(s=>s.children.some(c=>c.tag==='canvas')).length<=3,true);
assert.equal(viewport.children[0].children.some(c=>c.tag==='canvas'),false,
 'Offscreen rasterized page is discarded');
const goPrev=toolbar.children.find(el=>el.title==='Предыдущая страница');
goPrev.click();await settle();
assert.equal(Number(pageBox.value),4,'Page navigation works inside the scroll mode');

const zoomUp=toolbar.children.find(el=>el.title==='Увеличить PDF');
zoomUp.click();await settle();
assert.equal(viewport.children.filter(s=>s.children.some(c=>c.tag==='canvas')).length<=3,true,
 'Zoom must preserve memory cap');
modeButton.click();await settle();
assert.equal(modeButton.textContent,'Лента');
assert.equal(modeButton['aria-pressed'],'false');
assert.equal(viewport.children.length,1,'Return to single page');
assert.equal(viewport.children[0].tag,'canvas');
assert.equal(Number(pageBox.value),4,'Switch retains the current page');
modeButton.click();await settle();
assert.equal(viewport.children.length,7,'Can switch to continuous mode again');
dialog.emit('close');await settle();
assert.equal(destroyed,1,'Close destroys the PDF loading task');
assert.ok(cancelled>0,'Switching and scrolling release old render tasks');
console.log('PDF_SCROLL_MODE_OK toggle=true wheel=true bounded_canvases=3 zoom=true navigation=true close=true rendered='+rendered);
