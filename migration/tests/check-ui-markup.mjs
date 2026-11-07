// Diagnostic for counter placement in the compiled archived UI.
import {readFileSync} from 'node:fs';
const app=readFileSync('public/app.js','utf8');
for(const needle of [
 'data-act="project"','data-act="chat"','data-act="convo"',
 'class="convos"','class="sidebar"',
 'function sidebar(){','function convoNav(){','function messageView(m)',
 'msgscroll'
]){
 const index=app.indexOf(needle);
 console.log('ARTAE_UI_MARKER',JSON.stringify(needle),'index=',index,
  index>=0?JSON.stringify(app.slice(Math.max(0,index-110),index+230)):'NOT_FOUND');
}


const messagesAt=app.indexOf('function messageView(m)');
const sidebarAt=app.indexOf('function sidebar(){');
const navAt=app.indexOf('function convoNav(){');
console.log('ARTAE_UI_SIDEBAR',JSON.stringify(app.slice(sidebarAt,sidebarAt+650)));
console.log('ARTAE_UI_CONVOS',JSON.stringify(app.slice(navAt,navAt+850)));
console.log('ARTAE_UI_MESSAGE',JSON.stringify(app.slice(messagesAt,messagesAt+4600)));
