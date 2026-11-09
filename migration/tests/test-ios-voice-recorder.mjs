// iOS regression: Safari's MediaRecorder may return no MP4 bytes if stopped
// immediately after microphone permission, or if requestData() flushes early.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const src=readFileSync('server/voice-client.js','utf8');
const listeners=new Map();
function register(k,fn){if(!listeners.has(k))listeners.set(k,[]);listeners.get(k).push(fn)}
const root={addEventListener:register,querySelector:()=>null};
const window={addEventListener:register};
const document={hidden:false,addEventListener(){}};
let tick=0,timeoutId=0;
const timers=new Map();
function later(fn,delay){const id=++timeoutId;timers.set(id,{fn,at:tick+delay});return id}
function clearLater(id){timers.delete(id)}
function advance(delta){
 tick+=delta;
 for(const [id,t]of [...timers])if(t.at<=tick){timers.delete(id);t.fn()}
}
const clock={now:()=>tick};
const packets=[],messages=[],alerts=[],recorders=[];
const tracks=[];
function MediaRecorder(stream,opts){
 this.mimeType=opts.mimeType;
 this.state='inactive';
 this.flushed=false;this.startedWithSlice=false;
 this.start=(slice)=>{this.startedWithSlice=slice!==undefined;this.state='recording';this.started=tick};
 this.requestData=()=>{this.flushed=true};
 this.stop=()=>{
  this.state='inactive';
  const canEncode=tick-this.started>=1000&&!this.flushed&&!this.startedWithSlice;
  queueMicrotask(()=>{
   this.ondataavailable?.({data:new Blob(canEncode?['encoded-mp4']:[],{type:'audio/mp4'})});
   this.onstop?.();
  });
 };
 recorders.push(this);
}
MediaRecorder.isTypeSupported=type=>['audio/mp4','audio/webm;codecs=opus','audio/webm'].includes(type);
const sandbox={
 window,document,root,MediaRecorder,Blob,
 navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X)',mediaDevices:{
  getUserMedia:async()=>({getTracks:()=>[{stop(){tracks.push('stop')}}]})
 }},
 Date:clock,Math,Map,Set,console,URLSearchParams,
 URL:{createObjectURL:()=> 'blob:ios',revokeObjectURL(){}},
 crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
 convo:'22222222-2222-4222-8222-222222222222',
 data:{messages:[]},syncApi:async(action,body)=>{messages.push({action,body});return {message:{id:body.requestId}}},
 syncMessages(){},render(){},composerRefresh(){},voiceTranscriptButton(){return ''},
 voiceTranscriptResult(){return ''},
 alert:v=>alerts.push(v),
 fetch:async(url,options)=>{packets.push({url,options});return {ok:true}},
 setTimeout:later,clearTimeout:clearLater,
 setInterval(){return 111},clearInterval(){},
};
runInNewContext(src,sandbox);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();await new Promise(setImmediate)};
await sandbox.voiceStart();
assert.equal(recorders.length,1);
assert.equal(recorders[0].mimeType,'audio/mp4','iPhone prefers native MP4');
assert.equal(recorders[0].startedWithSlice,false,'iOS avoids timesliced MP4');
sandbox.voiceStop(true);
assert.equal(recorders[0].state,'recording','early release must not close the encoder');
advance(900);await flush();
assert.equal(messages.length,0);
advance(250);await flush();
assert.equal(recorders[0].state,'inactive');
assert.equal(recorders[0].flushed,false,'no early requestData on iOS');
assert.equal(packets.length,1);
assert.equal(messages.length,1,'completed MP4 must send');
assert.equal(alerts.length,0,'no empty recording alert');
assert.match(messages[0].body.text,/^\[\[voice:v1:.*:mp4:/);
await sandbox.voiceStart();
sandbox.voiceStop(true);
sandbox.voiceCancel();
advance(2000);await flush();
assert.equal(messages.length,1,'cancelled pending stop must not send');
assert.equal(timers.size,0,'pending iOS stop timeout cleared');
assert.ok(tracks.length>=2,'tracks released after send or cancellation');
console.log('IOS_VOICE_SAFARI_OK mp4=true no_timeslice=true no_early_requestData=true minimum_duration=true cancel_safe=true');
