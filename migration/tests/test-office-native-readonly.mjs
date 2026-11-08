// Native Office preview must keep search, sheet navigation and copying, while
// blocking actual model mutations. Run on assembled pinned VibeOffice bundle.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const src=readFileSync('server/office-readonly.js','utf8');
const assembled=readFileSync('public/office/artae-readonly.js','utf8');
assert.equal(assembled,src,'Only one shared office-readonly implementation');
const quire=readFileSync('public/office/quire/js/app.js','utf8');
const quireModel=readFileSync('public/office/quire/js/dmodel.js','utf8');
const quireEditor=readFileSync('public/office/quire/js/editor.js','utf8');
const ledger=readFileSync('public/office/ledger/js/app.js','utf8');
const ledgerOps=readFileSync('public/office/ledger/js/ops.js','utf8');
const ledgerGrid=readFileSync('public/office/ledger/js/grid.js','utf8');
assert.match(quire,/A\.setView = function/);
assert.match(quireModel,/D\.tx = function/);
assert.match(quireEditor,/E\.guard = function/);
assert.match(ledger,/A\.activateSheet = function/);
assert.match(ledgerOps,/O\.tx = function/);
assert.match(ledgerGrid,/G\.guardProtect = function/);
for(const p of ['public/office/quire/index.html','public/office/ledger/index.html']){
 const html=readFileSync(p,'utf8');
 const readOnlyAt=html.indexOf('../artae-readonly.js');
 const bridgeAt=html.indexOf('../artae-bridge.js');
 assert.ok(readOnlyAt>0&&bridgeAt>readOnlyAt,p+' load order');
}

let mutations=0,execCalls=[],readAlerts=0;
const calls=[];
function mockEnv(which){
 const listeners={};
 const doc={
  head:{append(){}},
  documentElement:{dataset:{}},
  createElement(type){return {tag:type,textContent:''}},
  getElementById(id){return id==='fbinput'?{tagName:'TEXTAREA',id,readOnly:false}:null},
  addEventListener(type,fn,capture){assert.equal(capture,true);(listeners[type]??=[]).push(fn)}
 };
 const api={
  app:{view:'print',setView(v){this.view=v;calls.push('view:'+v)}},
  ui:{exec(key){execCalls.push(key);return true}},
  saveFile(){mutations++;return 'download'}
 };
 if(which==='quire'){
  api.ed={readOnly:false};
  api.layout={root:{contentEditable:'true'},setMultiPage(n){calls.push('multi:'+n)},
   zoomFor(x){return x==='pageWidth'?0.9:1},setZoom(z){calls.push('zoom:'+z)}};
  api.D={tx(name,fn){return fn()}};
 }else{
  api.ops={tx(wb,name,fn){return fn()}};
  api.grid={guardProtect(){return false},input:{tagName:'TEXTAREA',id:'grid-input',readOnly:false}};
  api.editor={begin(){mutations++;return true}};
  api.app.activateSheet=function(i){calls.push('sheet:'+i)};
 }
 const box={window:{L:api,matchMedia:()=>({matches:true})},document:doc,console};
 runInNewContext(src,box,{filename:'artae-readonly.js'});
 const ro=box.window.ARTAE_OFFICE_READONLY;
 assert.ok(ro&&typeof ro.activate==='function');
 return {ro,doc,api,listeners};
}
const q=mockEnv('quire'),oldTx=q.api.D.tx,oldExec=q.api.ui.exec;
// Quire's pinned model is exposed as L.D, not L.doc.
assert.match(quireModel,/const D = \(L\.D = \{\}\)/);
assert.match(src,/guard\(L\.D,'tx',false\)/);
assert.doesNotMatch(src,/L\.doc/);
q.ro.activate('quire');
assert.equal(q.ro.active,true);
assert.equal(q.api.app.view,'reading');
assert.equal(q.api.ed.readOnly,true);
assert.equal(q.api.layout.root.contentEditable,'false');
assert.equal(q.api.D.tx('change',()=>{mutations++}),false);
assert.equal(q.api.saveFile('a.docx'),undefined);
assert.equal(q.api.ui.exec('save'),false);
assert.equal(q.api.ui.exec('find'),true);
assert.equal(q.doc.documentElement.dataset.artaeOfficeViewer,'1');
assert.ok(calls.includes('multi:0'),'Android must disable two-page reading layout');
const checkKeyboard=(env,type,key,tag='DIV',id='',ctrl=false)=>{
 let prevented=false,stopped=false;
 const e={type,key,ctrlKey:ctrl,metaKey:false,altKey:false,
  target:{tagName:tag,id},cancelable:true,
  preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}};
 for(const fn of env.listeners[type]||[])fn(e);
 return {prevented,stopped};
};
assert.deepEqual(checkKeyboard(q,'keydown','x'),{prevented:true,stopped:true});
assert.deepEqual(checkKeyboard(q,'keydown','ArrowDown'),{prevented:false,stopped:false});
assert.deepEqual(checkKeyboard(q,'keydown','f','DIV','',true),{prevented:false,stopped:false});
assert.deepEqual(checkKeyboard(q,'beforeinput','', 'INPUT','find-term'),{prevented:false,stopped:false},
 'Typing into Find must still work');
assert.deepEqual(checkKeyboard(q,'beforeinput','', 'DIV','pages'),{prevented:true,stopped:true});
q.ro.release();
assert.equal(q.ro.active,false);
assert.equal(q.api.D.tx,oldTx);
assert.equal(q.api.ui.exec,oldExec);
assert.equal(q.api.ed.readOnly,false);
assert.equal(q.api.layout.root.contentEditable,'true');
assert.equal(q.api.app.view,'print');
q.api.D.tx('edit',()=>{mutations++});
assert.equal(mutations,1,'Quire edits work again in true edit mode');

const x=mockEnv('ledger');
const oldLedger={tx:x.api.ops.tx,protect:x.api.grid.guardProtect,begin:x.api.editor.begin,
 save:x.api.saveFile,exec:x.api.ui.exec};
x.ro.activate('ledger');
assert.equal(x.api.ops.tx(null,'edit',()=>{mutations++}),false);
assert.equal(x.api.grid.guardProtect(),true);
assert.equal(x.api.editor.begin(),undefined);
assert.equal(x.api.grid.input.readOnly,true);
assert.equal(x.api.saveFile('copy.xlsx'),undefined);
assert.equal(x.api.ui.exec('find'),true);
assert.equal(x.api.ui.exec('nextSheet'),true);
assert.equal(x.api.ui.exec('insertSheet'),false);
assert.deepEqual(checkKeyboard(x,'keydown','v','DIV','',true),{prevented:true,stopped:true});
assert.deepEqual(checkKeyboard(x,'beforeinput','', 'TEXTAREA','fbinput'),{prevented:true,stopped:true});
assert.deepEqual(checkKeyboard(x,'keydown','t','INPUT','search'),{prevented:false,stopped:false});
x.api.app.activateSheet(2);
assert.ok(calls.includes('sheet:2'));
x.ro.release();
for(const [k,v] of Object.entries(oldLedger)){
 const actual=k==='tx'?x.api.ops.tx:k==='protect'?x.api.grid.guardProtect:
  k==='begin'?x.api.editor.begin:k==='save'?x.api.saveFile:x.api.ui.exec;
 assert.equal(actual,v,'Ledger '+k+' must be restored');
}
assert.equal(x.api.grid.input.readOnly,false);
x.api.ops.tx(null,'edit',()=>{mutations++});
assert.equal(mutations,2);

for(const p of ['server/office-frame.js','office-site/integration/office-frame.js']){
 const code=readFileSync(p,'utf8');
 assert.match(code,/readonly:msg\.readonly===true/);
 assert.match(code,/viewOnly\(\)\.activate\(document\.documentElement\.dataset\.app\)/);
 assert.match(code,/msg\.remoteSave===true/);
 assert.match(code,/artae-office-find/);
}
for(const p of ['server/office-client.js','office-site/integration/office-client.js']){
 const client=readFileSync(p,'utf8');
 assert.match(client,/readonly:mode==='preview'/);
 assert.match(client,/msg\.readonly!==true/);
 assert.match(client,/if\(mode==='preview'\)frame\.style\.visibility='hidden'/);
 assert.match(client,/frame\.style\.visibility='';/);
 assert.match(client,/Оригинал открыт · только чтение/);
 assert.doesNotMatch(client,/if\(ctx\.mode==='preview'\)\{state\.textContent='Создаём PDF…'/);
 assert.match(client,/mode==='edit'&&!localFile/,'Edit still requires its lease');
}
assert.match(readFileSync('public/app-version.json','utf8'),/"version":"0\.4\.9-preview"/);
console.log('OFFICE_NATIVE_READONLY_OK quire=true ledger=true search=true sheet_navigation=true restores=true no_auto_pdf=true');
