// Pinned messages must navigate to their conversation; pinned files open their folder.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const ux=readFileSync('server/ux-client.js','utf8');
const patch=readFileSync('server/files-patch.mjs','utf8');
const files=readFileSync('server/files-client.js','utf8');

assert.ok(ux.includes("isFile?'jumpPinnedFile':'railJumpPin'"),'Rail file pins must not trigger preview');
assert.ok(patch.includes("if(action==='jumpPinnedFile'){jumpPinnedFile(el.dataset.path);return}"),'Delegated file pin action');
assert.ok(ux.includes("const originalPinCard=pinCard"),'Full-screen pinned cards are decorated');
assert.ok(ux.includes("view!=='pins'&&view!=='projectpins'"),'Pin click listener stays scoped to pin views');
assert.ok(ux.includes("['goMessage','goFile','filesPreview','railJumpPin','jumpPinnedFile']"),'Pinned card primary actions navigate');
assert.ok(ux.includes("event.stopImmediatePropagation()"),'Navigation must not trigger old preview actions');
assert.ok(ux.includes("if(control&& !"),'Pin management controls must be left alone');
assert.ok(files.includes("function openExplorer(path='')"),'Use the existing project file explorer');
assert.ok(ux.includes("if(p.kind==='file'){"),'Pinned file has a separate card');
assert.ok(ux.includes('explorerFileTypeIcon(name)'),'Pinned file uses explorer SVG icons');
assert.ok(ux.includes('artaePinnedFileCard'),'Pinned file does not imitate a chat message');
assert.ok(ux.includes('artaePinnedFileRemove'),'Pinned file has direct unpin control');
assert.ok(!ux.includes("'📄 ':'📌 '"),'Rail file pins no longer use emoji file icons');
assert.ok(patch.includes('.pin-card,.artaePinnedFileCard{border:2px'),'Pinned cards use thicker borders');


const between=(start,end)=>{const i=ux.indexOf(start);assert.ok(i>=0,start);const j=ux.indexOf(end,i+start.length);assert.ok(j>i,end);return ux.slice(i,j)};
const fileCode=between('function jumpPinnedFile(path){','// Make existing pinned cards');
let folder=null,revealed=false,alerted='';
const item={dataset:{path:'planning/2026/budget.xlsm'},scrollIntoView(){revealed=true}};
let explorerRequest=0;
const fileEnv={
 explorer:{path:'',loading:false},get explorerRequest(){return explorerRequest},
 setTimeout(fn){fn()},project:'project1',alert(s){alerted=s},
 openExplorer(path){folder=path;fileEnv.explorer.path=path;explorerRequest++},
 root:{querySelectorAll(){return [item]}}
};
const jumpPinnedFile=runInNewContext(fileCode+'\njumpPinnedFile',fileEnv);
jumpPinnedFile('planning/2026/budget.xlsm');
assert.equal(folder,'planning/2026','File pin opens parent folder');
assert.equal(revealed,true,'File pin scrolls to file');
folder=null;revealed=false;
jumpPinnedFile('budget.xlsm');
assert.equal(folder,'','Root-level file opens root folder');
folder=null;jumpPinnedFile('../secret');
assert.equal(folder,null,'Invalid parent segment cannot navigate');
assert.ok(alerted,'Invalid path shows warning');

const msgCode=between('async function railJumpPin(item,targetConvo){','function jumpPinnedFile(path){');
const msgEnv={
 project:'p1',convo:'old',view:'pins',highlightId:null,openMenu:'open',
 data:{convos:[{id:'c1',project:'p1'}],messages:[]},
 lastMessageCursor:{c1:54321},render(){},saveWorkplace(){},
 stopRealtime(){msgEnv.stopped=true},
 async syncMessages(){msgEnv.data.messages.push({id:'m1',convo:'c1'})},
 connectRealtime(id){msgEnv.connected=id},
 requestAnimationFrame(fn){fn()},
 document:{getElementById(id){return id==='m1'?{scrollIntoView(){msgEnv.scrolled=true}}:null}},
 alert(message){msgEnv.alerted=message}
};
const jumpMessage=runInNewContext(msgCode+'\nrailJumpPin',msgEnv);
await jumpMessage('m1','c1');
assert.equal(msgEnv.view,'chat');
assert.equal(msgEnv.convo,'c1');
assert.equal(msgEnv.lastMessageCursor.c1,0,'Missing historical message forces full sync');
assert.equal(msgEnv.connected,'c1','Realtime reconnects to target conversation');
assert.equal(msgEnv.scrolled,true,'Target message becomes visible');
assert.equal(msgEnv.highlightId,'m1');

assert.equal(JSON.parse(readFileSync('public/app-version.json','utf8')).version,'0.4.21-preview');
console.log('PINNED_NAVIGATION_OK message=true history=true file_folder=true root=true');
