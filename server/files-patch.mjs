// Build-time integration of the project explorer into existing UI.
import {readFileSync,writeFileSync} from 'node:fs';
const b=String.fromCharCode(96),path='public/app.js';
let app=readFileSync(path,'utf8');
const replace=(oldText,newText,label)=>{
 if(!app.includes(oldText))throw Error('Explorer patch mismatch: '+label);
 app=app.replace(oldText,newText);
};
const client=readFileSync('server/files-client.js','utf8');
replace('function cp(){',client+'\nfunction cp(){','client functions');
replace('return '+b+'<aside class="convos">${convos().map',
        'return '+b+'<aside class="convos"><button class="add explorerLink" type="button" data-act="filesHome">📁 Файлы проекта</button>${convos().map',
        'project file navigation');
replace("return view==='conversations'?", "return (view==='conversations'||view==='files')?",'project file heading');
replace("${view==='pins'||view==='projectpins'?pinsView():chatView()}",
        "${view==='files'?filesView():view==='pins'||view==='projectpins'?pinsView():chatView()}",
        'explorer workspace pane');
replace("if(action==='project')openProject(id);",
        "if(action==='filesHome')openExplorer();else if(action==='filesReload')explorerLoad(explorer.path);else if(action==='filesOpen')explorerLoad(el.dataset.path);else if(action==='filesUp')explorerLoad(explorer.path.split('/').slice(0,-1).join('/'));else if(action==='filesMkdir')explorerMkdir();else if(action==='project')openProject(id);",
        'explorer actions');
replace("else if(view==='chat')switchView('conversations');else if(view==='conversations')switchView('projects');",
        "else if(view==='chat'||view==='files')switchView('conversations');else if(view==='conversations')switchView('projects');",
        'explorer back action');
writeFileSync(path,app);
const cssFile='public/styles.css';
let css=readFileSync(cssFile,'utf8');
css+='\n'+[
'.explorerPane{flex:1;min-width:0;overflow:auto;padding:22px}',
'.explorerToolbar{display:flex;justify-content:space-between;align-items:start;gap:14px;margin-bottom:18px}',
'.explorerToolbar h2{margin:0 0 5px;font-size:20px}',
'.explorerPath{overflow-wrap:anywhere;margin:0}',
'.explorerList{margin-top:14px;border:1px solid #e5e8ef;border-radius:12px;overflow:hidden}',
'.fileEntry{display:flex;align-items:center;gap:12px;width:100%;min-width:0;padding:12px 14px;background:transparent;border:0;border-bottom:1px solid #e5e8ef;color:inherit;text-align:left;font:inherit}',
'.fileEntry:last-child{border-bottom:0}',
'button.fileEntry{cursor:pointer}',
'button.fileEntry:hover{background:rgba(120,140,160,.09)}',
'.fileGlyph{flex:none;font-size:19px}',
'.fileEntryName{flex:1;min-width:0;overflow-wrap:anywhere}',
'.fileEntryMeta{flex:none;opacity:.65;font-size:12px}',
'.explorerLink{margin-bottom:12px}',
'@media(max-width:720px){.explorerPane{padding:14px}.explorerToolbar h2{font-size:18px}.fileEntry{padding:12px 9px}}'
].join('\n');
writeFileSync(cssFile,css);
