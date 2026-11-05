// Build-time integration of the project explorer into existing UI.
import {readFileSync,writeFileSync} from 'node:fs';
const b=String.fromCharCode(96),path='public/app.js';
let app=readFileSync(path,'utf8');
const replace=(oldText,newText,label)=>{
 if(!app.includes(oldText))throw Error('Explorer patch mismatch: '+label);
 app=app.replace(oldText,newText);
};
const client=readFileSync('server/files-client.js','utf8');
const resizeClient=readFileSync('server/layout-resize.js','utf8');
replace('function cp(){',client+'\n'+resizeClient+'\nfunction cp(){','client and resize functions');
replace('return '+b+'<aside class="convos">${convos().map',
        'return '+b+'<aside class="convos"><button class="add explorerLink" type="button" data-act="filesHome">📁 Файлы проекта</button>${convos().map',
        'project file navigation');
replace("return view==='conversations'?", "return (view==='conversations'||view==='files')?",'project file heading');
replace("${view==='pins'||view==='projectpins'?pinsView():chatView()}",
        "${view==='files'?filesView():view==='pins'||view==='projectpins'?pinsView():chatView()}",
        'explorer workspace pane');
replace("if(action==='project')openProject(id);",
        "if(action==='filesHome')openExplorer();else if(action==='filesReload')explorerLoad(explorer.path);else if(action==='filesOpen')explorerLoad(el.dataset.path);else if(action==='filesUp')explorerLoad(explorer.path.split('/').slice(0,-1).join('/'));else if(action==='filesMkdir')explorerMkdir();else if(action==='filesUpload')root.querySelector('#explorerUpload')?.click();else if(action==='filesDownload')explorerDownload(el.dataset.path,el.dataset.name);else if(action==='project')openProject(id);",
        'explorer actions');
replace("else if(view==='chat')switchView('conversations');else if(view==='conversations')switchView('projects');",
        "else if(view==='chat'||view==='files')switchView('conversations');else if(view==='conversations')switchView('projects');",
        'explorer back action');

replace('${sidebar()}<main class="main">',
        '${sidebar()}<div class="columnGrip projectGrip" data-resize="projects" role="separator" tabindex="0" aria-label="Ширина списка проектов" aria-orientation="vertical" title="Изменить ширину списка проектов"></div><main class="main">',
        'project resizer');
replace('${convoNav()}${view===',
        '${convoNav()}<div class="columnGrip convoGrip" data-resize="conversations" role="separator" tabindex="0" aria-label="Ширина списка разговоров" aria-orientation="vertical" title="Изменить ширину списка разговоров"></div>${view===',
        'conversation resizer');


replace("<button type=\"button\" role=\"menuitem\" data-act=\"authUsers\">Пользователи</button>","<button type=\"button\" role=\"menuitem\" data-act=\"authUsers\">Пользователи</button><button type=\"button\" role=\"menuitem\" data-act=\"restoreProjects\">Восстановить проект</button>","admin restore menu");
replace("<button type=\"submit\" class=\"btn primary\">Сохранить</button>","${modal.type==='editProject'&&window.ARTAE_AUTH?.getUser()?.role==='admin'?'<button type=\"button\" class=\"btn\" data-act=\"trashProject\" data-id=\"'+esc(modal.id)+'\">Удалить проект</button>':''}<button type=\"submit\" class=\"btn primary\">Сохранить</button>","project delete button");
replace("if(action==='filesHome')openExplorer();","if(action==='trashProject')trashProject(id);else if(action==='restoreProjects')restoreProjectPicker();else if(action==='filesHome')openExplorer();","project archive handlers");

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
'.explorerActions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}',

'.workspace{position:relative;grid-template-columns:var(--project-col-width,290px) minmax(0,1fr)}',
'.split{position:relative;grid-template-columns:var(--convo-col-width,250px) minmax(0,1fr)}',
'.columnGrip{position:absolute;top:0;bottom:0;width:10px;margin-left:-5px;z-index:5;cursor:col-resize;touch-action:none;background:transparent}',
'.columnGrip:hover,.columnGrip:focus-visible,.resizingColumns .columnGrip{background:rgba(40,105,220,.14);outline:none}',
'.columnGrip::after{content:"";position:absolute;left:4px;top:0;bottom:0;width:2px;background:transparent}',
'.columnGrip:hover::after,.columnGrip:focus-visible::after{background:#5893e8}',
'.projectGrip{left:var(--project-col-width,290px)}',
'.convoGrip{left:var(--convo-col-width,250px)}',
'.resizingColumns,.resizingColumns *{cursor:col-resize!important;user-select:none!important}',
'@media(max-width:650px){.columnGrip{display:none}.app.mobile-files .sidebar,.app.mobile-files .convos{display:none}.app.mobile-files .main{display:flex;height:100%}.app.mobile-files .split{display:block;height:calc(100% - 55px)}.app.mobile-files .explorerPane{display:block;height:100%;overflow:auto}.app.mobile-files .explorerToolbar{align-items:center}}',

'@media(max-width:720px){.explorerPane{padding:14px}.explorerToolbar h2{font-size:18px}.fileEntry{padding:12px 9px}}'
].join('\n');
writeFileSync(cssFile,css);
