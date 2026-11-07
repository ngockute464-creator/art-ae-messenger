import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync('server/composer-controls.js','utf8')+'\n'+readFileSync('server/voice-client.js','utf8');
const rootListeners=new Map(),windowListeners=new Map();
const on=(store,name,fn)=>{if(!store.has(name))store.set(name,[]);store.get(name).push(fn)};
const fire=(store,name,event)=>{for(const fn of store.get(name)||[])fn(event)};
const classes=new Set(),mic={hidden:false},send={hidden:true};
const bar={hidden:true,querySelector(name){
 if(name==='.voiceHoldTimer')return timer;
 if(name==='.voiceHoldHint')return hint;
 return null;
}};
const timer={textContent:''},hint={textContent:''};
const line={classList:{toggle(name,set){if(set)classes.add(name);else classes.delete(name)}},
 querySelector(name){return name==='.voiceMic'?mic:name==='.composerSend'?send:name==='.voiceHoldStatus'?bar:null;}};
const draft={text:'',files:[]},field={
 id:'draft',value:'',selectionStart:0,selectionEnd:0,scrollHeight:40,style:{},
 closest(name){return name==='.composeLine'?line:null},
 setRangeText(value,start,end){this.value=this.value.slice(0,start)+value+this.value.slice(end);
  this.selectionStart=this.selectionEnd=start+value.length;},
 dispatchEvent(evt){fire(rootListeners,evt.type,{target:this})}
};
const root={querySelector(name){return name==='#draft'?field:name==='.composeLine'?line:null},
 addEventListener(name,fn){on(rootListeners,name,fn)}};
const document={hidden:false,getElementById:()=>field,addEventListener(){}};
const window={addEventListener:(name,fn)=>on(windowListeners,name,fn)};
const micTarget={closest:name=>name==='[data-act="voiceStart"]'?mic:null};
const stopped=[];
const mkStream=()=>({getTracks(){return [{stop(){stopped.push(true)}}]}});
let pendingPermission=null, delayed=false;
const navigator={mediaDevices:{getUserMedia:()=>{
 if(delayed)return new Promise(resolve=>{pendingPermission=resolve});
 return Promise.resolve(mkStream());
}}};
const uploads=[],messages=[];
function MediaRecorder(stream,options){
 this.mimeType=options?.mimeType||'audio/webm';
 this.state='inactive';
 this.start=()=>{this.state='recording'};
 this.requestData=()=>{};
 this.stop=()=>{
  this.state='inactive';
  queueMicrotask(()=>{
   this.ondataavailable?.({data:new Blob(['voice'],{type:'audio/webm'})});
   this.onstop?.();
  });
 };
}
MediaRecorder.isTypeSupported=()=>true;
const context={
 root,document,window,navigator,MediaRecorder,Event,
 URL:{createObjectURL:()=> 'blob:voice',revokeObjectURL(){}},URLSearchParams,
 Blob,Date,Math,Map,Set,Uint8Array,console,
 getDraft:()=>draft,chatDraftItems:()=>[],
 crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
 convo:'22222222-2222-4222-8222-222222222222',project:'proj',
 data:{messages:[]},syncApi:async(a,body)=>{
  messages.push({action:a,body});
  return {message:{id:body.requestId,convo:context.convo}};
 },syncMessages(){},render(){},alert(message){throw Error('Unexpected alert '+message)},
 fetch:async(url,options)=>{uploads.push({url,options});return {ok:true,json:async()=>({})}},
 setInterval,clearInterval,setTimeout,clearTimeout,
};
runInNewContext(source,context,{filename:'composer-plus-voice.js'});
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve))};
const down=(pointerId=1,x=300)=>{
 const event={target:micTarget,pointerId,clientX:x,isPrimary:true,button:0,
  preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};
 fire(rootListeners,'pointerdown',event);
 assert.equal(event.prevented,true,'Mic must capture pointer down');
};
function up(id=1,x=300){fire(windowListeners,'pointerup',{pointerId:id,clientX:x})}
function move(id=1,x=100){fire(windowListeners,'pointermove',{pointerId:id,clientX:x})}
// Enter never submits: it inserts one newline and announces input.
field.value='First line';field.selectionStart=field.selectionEnd=10;
const enter={target:field,key:'Enter',isComposing:false,keyCode:13,
 preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true}};
fire(rootListeners,'keydown',enter);
assert.equal(enter.prevented,true);
assert.equal(enter.stopped,true);
assert.equal(field.value,'First line\n');
assert.equal(send.hidden,false);
assert.equal(mic.hidden,true);
field.value='';fire(rootListeners,'input',{target:field});
assert.equal(send.hidden,true);
assert.equal(mic.hidden,false);
// Gesture #1: release sends exactly one committed voice message.
down();await flush();
assert.equal(classes.has('voice-holding'),true);
assert.equal(bar.hidden,false);
up();await flush();
assert.equal(classes.has('voice-holding'),false);
assert.equal(uploads.length,1);
assert.equal(messages.length,1);
assert.match(messages[0].body.text,/^\[\[voice:v1:/);
// Gesture #2: left swipe cancels the recording; no upload or send.
down(2,350);await flush();
move(2,160);
assert.equal(classes.has('voice-canceling'),true);
up(2,150);await flush();
assert.equal(uploads.length,1);
assert.equal(messages.length,1);
// Gesture #3: permission resolves only after finger lifted; no stray upload.
delayed=true;down(3,320);up(3,320);await flush();
assert.equal(messages.length,1);
pendingPermission(mkStream());await flush();
assert.equal(messages.length,1);
assert.equal(uploads.length,1);
assert.ok(stopped.length>=3,'Cancelled and completed microphone tracks must be stopped');
// Keyboard click is a supported alternative for accessibility.
delayed=false;
const click={target:micTarget,detail:0,preventDefault(){},stopImmediatePropagation(){}};
fire(rootListeners,'click',click);await flush();
fire(rootListeners,'click',click);await flush();
assert.equal(messages.length,2);
console.log('MOBILE_COMPOSER_VOICE_GESTURES_OK newline=true release=true swipe_cancel=true permission_race=true keyboard=true');
