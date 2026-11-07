// Reproduce background full rerenders while an Android/iOS textarea is focused.
// The same input DOM node, caret and IME state must survive asynchronous updates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const guard=readFileSync('server/composer-focus-guard.js','utf8');
const app=readFileSync('public/app.js','utf8');
assert.ok(app.includes('composerUnprotectedRender=render'),
 'Focus guard must be present in the actual assembled app');
const listeners=new Map(),scheduled=[];
const root={
 addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},
 querySelector(selector){return selector==='#draft'?field:null}
};
const emit=(type,target)=>{for(const callback of listeners.get(type)||[])callback({target})};
const field={id:'draft',value:'Некоторый текст',selectionStart:8,selectionEnd:8,isConnected:true};
const document={activeElement:field};
let calls=0;
const ctx={
 root,document,view:'chat',project:'project-1',convo:'convo-1',
 modal:null,editing:null,
 render(){calls++},
 setTimeout(fn,ms){scheduled.push({fn,ms})}
};
runInNewContext(guard,ctx);
emit('focusin',field);
ctx.render();
assert.equal(calls,0,'Rerender during text entry must be deferred');
assert.equal(root.querySelector('#draft'),field,'Composer node replaced');
assert.equal(field.selectionStart,8,'Caret moved');
assert.equal(field.value,'Некоторый текст','Draft was erased');
emit('compositionstart',field);
document.activeElement={id:'body'};
ctx.render();
assert.equal(calls,0,'IME composition must remain protected despite transient focus');
emit('compositionend',field);
document.activeElement=field;
ctx.render();
assert.equal(calls,0,'Resumed typing must still be protected');

// Ordinary navigation must remain immediate, even if input was focused.
ctx.convo='convo-2';
ctx.render();
assert.equal(calls,1,'Navigation between conversations must render');

// A background render should flush only AFTER a genuine blur, not before click.
ctx.convo='convo-1';
emit('focusin',field);
ctx.render();
assert.equal(calls,1);
document.activeElement={id:'composerSend'};
emit('focusout',field);
assert.equal(calls,1,'Send click must not be detached during focusout');
assert.equal(scheduled.at(-1).ms,240);
scheduled.pop().fn();
assert.equal(calls,2,'Deferred background update must render after blur');

// If the user refocuses before the delay, do not detach the input.
document.activeElement=field;
emit('focusin',field);
ctx.render();
document.activeElement={id:'composerAttach'};
emit('focusout',field);
const pending=scheduled.pop();
document.activeElement=field;
emit('focusin',field);
pending.fn();
assert.equal(calls,2,'Refocused composer must remain intact');

// Deliberately changing view always renders, even with focused composer.
ctx.view='files';
ctx.render();
assert.equal(calls,3,'Navigation to files must not be suppressed');
console.log('COMPOSER_FOCUS_TEST_OK active_input=true caret=true ime=true blur_flush=true navigation=true');
