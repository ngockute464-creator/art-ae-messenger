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
const uxClient=readFileSync('server/ux-client.js','utf8');
const mentionsClient=readFileSync('server/file-mentions.js','utf8');
const officeClient=readFileSync('server/office-client.js','utf8');
const reliableSend=readFileSync('server/reliable-send.js','utf8');
const voiceClient=readFileSync('server/voice-client.js','utf8');
replace('function cp(){',client+'\n'+resizeClient+'\n'+uxClient+'\n'+mentionsClient+'\n'+officeClient+'\n'+reliableSend+'\n'+voiceClient+'\nfunction cp(){','client and resize functions');

 // Capture the version when entering edit mode (not at save time).
replace("editing={messageId:id,text:m.text,files:","editing={messageId:id,baseEditedAt:m.editedAt??null,text:m.text,files:",'edit baseline');
replace("syncApi('edit',{id:m.id,convo:m.convo,text})","syncApi('edit',{id:m.id,convo:m.convo,text,expectedEditedAt:editing.baseEditedAt})",'conditional message edit');
replace("syncApi('delete',{id,convo:msg.convo})","syncApi('delete',{id,convo:msg.convo,expectedEditedAt:msg.editedAt??null})",'conditional message delete');

replace('return '+b+'<aside class="convos">${convos().map',
        'return '+b+'<aside class="convos"><button class="add explorerLink" type="button" data-act="filesHome">📁 Файлы проекта</button>${convos().map',
        'project file navigation');
replace("return view==='conversations'?", "return (view==='conversations'||view==='files')?",'project file heading');
replace("${view==='pins'||view==='projectpins'?pinsView():chatView()}",
        "${view==='files'?filesView():view==='pins'||view==='projectpins'?pinsView():chatView()}",
        'explorer workspace pane');
replace("if(action==='project')openProject(id);",
        "if(action==='filesHome')openExplorer();else if(action==='filesReload')explorerLoad(explorer.path);else if(action==='filesOpen')explorerLoad(el.dataset.path);else if(action==='filesUp')explorerLoad(explorer.path.split('/').slice(0,-1).join('/'));else if(action==='filesMkdir')explorerMkdir();else if(action==='filesUpload')root.querySelector('#explorerUpload')?.click();else if(action==='filesDelete')explorerDelete(el.dataset.path,el.dataset.name);else if(action==='filesDownload')explorerDownload(el.dataset.path,el.dataset.name);else if(action==='filesPreview')explorerPreview(el.dataset.path,el.dataset.name,el.dataset.mime);else if(action==='project')openProject(id);",
        'explorer actions');
replace("else if(view==='chat')switchView('conversations');else if(view==='conversations')switchView('projects');",
        "else if(view==='files')returnFromResources();else if(view==='chat')switchView('conversations');else if(view==='conversations')switchView('projects');",
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
replace("if(action==='trashProject')trashProject(id);","if(action==='retrySend'){retryOutgoing(id);return}else if(action==='trashProject')trashProject(id);",'retry outgoing action');

replace("data.pins=preferences.pins||[];data.labels=preferences.labels||[];","data.pins=[];data.labels=preferences.labels||[];",'ux patch 1');
replace("profile:data.profile,pins:data.pins,labels:data.labels","profile:data.profile,labels:data.labels",'ux patch 2');
replace("async function beginSync(){try{await syncOverview();syncReady=true;","async function beginSync(){try{await syncOverview();restoreWorkplace();await refreshPins();queueMicrotask(()=>refreshRailFiles());syncReady=true;",'ux patch 3');
replace("📌 Закреплено</button>","📌 <span class=\"pinLabel\">Закреплено</span></button>",'ux patch 4');
replace("${backButton}${pinButton}<div class=\"profileMenuWrap\">","${backButton}${pinButton}<button type=\"button\" class=\"btn small headerNav mobileFilesTop\" data-act=\"filesHome\" title=\"Файлы проекта\" aria-label=\"Файлы проекта\">📁</button><div class=\"profileMenuWrap\">",'ux patch 5');
replace("<div class=\"app mobile-${view}\">","<div class=\"app mobile-${view}${railCollapsed?' rail-collapsed':''}\">",'ux patch 6');
replace("${view==='files'?filesView():view==='pins'||view==='projectpins'?pinsView():chatView()}","${view==='files'?filesView():view==='pins'||view==='projectpins'?pinsView():chatView()}${view!=='files'?desktopRail():''}",'ux patch 7');
replace("Закрепления пока сохраняются только на этом устройстве","Общие закрепления всех участников",'ux patch 8');
replace("function pinCard(p){let msg=p.kind==='message'?data.messages.find(m=>m.id===p.item):data.messages.find(m=>m.id===data.files.find(f=>f.id===p.item)?.message);","function pinCard(p){let msg=p.kind==='message'?(data.messages.find(m=>m.id===p.item)||{id:p.item,convo:p.convoId,text:p.previewText,who:'',time:p.createdAt}):data.messages.find(m=>m.id===data.files.find(f=>f.id===p.item)?.message);",'ux patch 9');
replace("let file=p.kind==='file'?data.files.find(f=>f.id===p.item):null;let actions=","let file=p.kind==='file'?(data.files.find(f=>f.id===p.item)||{name:p.item.split('/').pop()}):null;let actions=",'ux patch 10');
replace('linkify(msg?.text||\'Сообщение удалено\')','linkify(pinTextSummary(msg?.text||\'Сообщение удалено\'))','pinned message file names');
replace("if(pin)pin.note=val;persist();","if(pin){await updateRemoteNote(m.id,val);pin.note=val;}",'ux patch 11');
replace("if(action==='toggleProfileMenu'){","if((action==='pins'||action==='projectpins')&&view==='chat')rememberResourceOrigin();if(action==='railTab'){railTab=el.dataset.tab||'files';saveWorkplace();render();if(railTab==='files'&&explorer.project!==project)explorerLoad('');return}if(action==='railCollapse'){railCollapsed=!railCollapsed;saveWorkplace();render();if(!railCollapsed&&railTab==='files'&&explorer.project!==project)explorerLoad('');return}if(action==='railSection'){workspaceState['collapsed_'+scope]=!workspaceState['collapsed_'+scope];try{localStorage.setItem(WORKSPACE_KEY,JSON.stringify(workspaceState))}catch{}render();return}if(action==='railJumpPin'){railJumpPin(id,el.dataset.convo);return}if(action==='pinFile'){toggleRemotePin('file',el.dataset.path,'project',project);return}if(action==='togglePin'){toggleRemotePin(kind,id,scope,scope==='project'?project:convo);openMenu=null;render();return}if(action==='removePin'){removeRemotePin(id);return}if(action==='goMessage'&&!data.messages.find(m=>m.id===id)){const pin=data.pins.find(p=>p.item===id);if(pin?.convoId){railJumpPin(id,pin.convoId);return}}if(action==='toggleProfileMenu'){",'ux patch 12');

// Voice UI is inserted into the existing composer and message renderer.
replace('<textarea id="draft"','${voiceMicButton()}<textarea id="draft"','voice microphone button');
replace('<button class="btn primary" type="submit">Отправить</button></div>','<button class="btn primary" type="submit">Отправить</button></div>${voicePanel()}','voice composer preview');
replace('${linkify(m.text)}','${voiceMessageHtml(m)}','voice message renderer');
replace("if(action==='retrySend'){retryOutgoing(id);return}","if(action==='voiceStart'){voiceStart();return}else if(action==='voiceStop'){voiceStop();return}else if(action==='voiceCancel'){voiceCancel();return}else if(action==='voiceSend'){voiceSend();return}else if(action==='voicePlay'){voicePlay(id);return}else if(action==='retrySend'){retryOutgoing(id);return}",'voice actions');
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
'.fileActionButtons{display:flex;flex:none;gap:6px}',
'.fileActionBtn{border:1px solid #d4dbe6;background:transparent;color:inherit;border-radius:8px;min-width:34px;height:34px;cursor:pointer;font-size:18px}',
'.fileActionBtn:hover,.fileActionBtn:focus-visible{background:rgba(120,140,160,.13)}',
'.filePinBtn{display:inline-flex;align-items:center;justify-content:center}',
'.filePinBtn.is-unpinned{color:#8c939d}',
'.filePinBtn.is-pinned{color:#159447}',
'.filePreviewDialog{width:min(900px,96vw);max-width:96vw;max-height:92vh;padding:0;border:1px solid #dde3ed;border-radius:14px;background:var(--surface,#fff);color:inherit;box-shadow:0 18px 60px #0004}',
'.filePreviewDialog::backdrop{background:#0008}',
'.filePreviewHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #dce1e9}',
'.filePreviewTitle{min-width:0;overflow-wrap:anywhere}',
'.filePreviewBody{padding:14px;overflow:auto;max-height:calc(92vh - 75px);min-height:120px}',
'.filePreviewMedia{display:block;width:100%;height:min(72vh,720px);border:0;object-fit:contain}',
'img.filePreviewMedia{height:auto;max-height:72vh;margin:auto}',
'audio.filePreviewMedia{height:64px}',
'.filePreviewText{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:13px/1.5 ui-monospace,monospace}',
'.filePreviewNotice{font-size:12px;opacity:.75;margin:0 0 12px}',
'.fileImageViewport{height:min(72vh,720px);min-height:220px;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;background:rgba(120,140,160,.07);border-radius:8px}',
'.fileImageViewport img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;user-select:none;transform-origin:center center}',
'.fileZoomTools{display:flex;gap:4px;margin-left:auto;margin-right:12px}',
'.fileZoomTools button{min-width:36px}',
'.filePreviewMedia[type="application/pdf"]{height:min(74vh,740px);min-height:320px}',

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
css+='\n'+[".mobileFilesTop{display:inline-flex}",
".explorerLink{display:none}",
".app.mobile-chat .split,.app.mobile-conversations .split,.app.mobile-pins .split,.app.mobile-projectpins .split{grid-template-columns:var(--convo-col-width,250px) minmax(0,1fr) var(--rail-width,280px)}",
".app.mobile-chat.rail-collapsed .split,.app.mobile-conversations.rail-collapsed .split,.app.mobile-pins.rail-collapsed .split,.app.mobile-projectpins.rail-collapsed .split{grid-template-columns:var(--convo-col-width,250px) minmax(0,1fr) 52px}",
".desktopRail{min-width:0;overflow:auto;background:#fafcff;border-left:1px solid #e4eaf3;display:flex;flex-direction:column;gap:10px;padding:12px}",
".desktopRailGrip{position:absolute;right:var(--rail-width,280px);width:8px;top:0;bottom:0;z-index:7;cursor:col-resize}",
".rail-collapsed .desktopRailGrip{display:none}",
".rail-collapsed .desktopRail{padding:4px;overflow:hidden}.rail-collapsed .railTop strong{display:none}",
".railTop{display:flex;align-items:center;justify-content:space-between;padding:5px 3px;font-size:13px}",
".railSection{border:1px solid #e0e7f0;background:#fff;border-radius:10px;overflow:hidden;min-width:0}",
".railSectionTitle{width:100%;border:0;background:#f8faff;display:flex;align-items:center;justify-content:space-between;text-align:left;padding:11px;font-weight:650;font-size:12px;cursor:pointer}",
".railSectionBody{padding:7px 9px;max-height:230px;overflow-y:auto}",
".railItem{display:flex;align-items:center;gap:4px;border-bottom:1px solid #eef1f5;padding:4px 0}",
".railItemName,.railPinnedItem{font-size:12px;text-align:left;overflow-wrap:anywhere;background:transparent;border:0;color:#31455e;cursor:pointer;padding:6px 4px;width:100%}",
".railItemName:hover,.railPinnedItem:hover{color:#2164bc;background:#f0f6ff}",
".railMini{border:0;border-radius:7px;background:transparent;cursor:pointer;padding:5px 7px;color:#44617d}",
".railMini:hover{background:#edf4ff}",
".railAll{border:0;background:transparent;color:#2869dc;font-size:11px;padding:7px 4px;cursor:pointer}",
".railPinnedItem{display:block;border-bottom:1px solid #eef1f5}",
".railEmpty{font-size:12px;color:#8a96a7;margin:5px}",
".fileEntryNameAction{flex:1;min-width:0;text-align:left;border:0;background:transparent;color:inherit;padding:6px 0;cursor:pointer;overflow-wrap:anywhere}",
".fileEntryNameAction:hover{text-decoration:underline;color:#2363bd}",
"button.fileActionBtn{cursor:pointer}",
"button[data-act],.navitem,.railItemName,.railPinnedItem{cursor:pointer}",
".desktopRail{grid-column:3;grid-row:1;min-height:0}",
"@media(max-width:1180px){.desktopRail,.desktopRailGrip{display:none}.app.mobile-chat .split,.app.mobile-chat.rail-collapsed .split,.app.mobile-conversations .split,.app.mobile-conversations.rail-collapsed .split,.app.mobile-pins .split,.app.mobile-pins.rail-collapsed .split,.app.mobile-projectpins .split,.app.mobile-projectpins.rail-collapsed .split{grid-template-columns:var(--convo-col-width,250px) minmax(0,1fr)}}",
"@media(max-width:650px){.mobileFilesTop{display:inline-flex}.pinLabel{display:none}.explorerLink{display:none}.app.mobile-chat .split,.app.mobile-chat.rail-collapsed .split,.app.mobile-conversations .split,.app.mobile-conversations.rail-collapsed .split,.app.mobile-pins .split,.app.mobile-projectpins .split{display:block}.app.mobile-chat .convos{display:none}}"].join('\n');
css+='\n'+"\n/* Desktop dual-workspace layout: equal default widths, adjustable divider. */\n@media(min-width:1181px){\n .app.mobile-chat .split,.app.mobile-conversations .split,.app.mobile-pins .split,.app.mobile-projectpins .split{\n  display:grid;grid-template-columns:var(--convo-col-width,250px) minmax(280px,1fr) minmax(280px,var(--rail-width,1fr));\n }\n .app.mobile-chat.rail-collapsed .split,.app.mobile-conversations.rail-collapsed .split,.app.mobile-pins.rail-collapsed .split,.app.mobile-projectpins.rail-collapsed .split{\n  grid-template-columns:var(--convo-col-width,250px) minmax(280px,1fr) 43px;\n }\n .app .mobileFilesTop{display:none!important}\n .app .headerNav[data-act=\"pins\"],.app .headerNav[data-act=\"projectpins\"],.app header [data-act=\"pins\"],.app header [data-act=\"projectpins\"]{display:none!important}\n .desktopRail{grid-column:3;grid-row:1;display:flex;flex-direction:column;overflow:hidden;padding:0;min-width:0;min-height:0}\n .desktopRailGrip{right:var(--rail-width,50%);grid-column:3;grid-row:1}\n .rail-collapsed .desktopRail{padding:0}\n .rail-collapsed .railTabs{display:none}\n .railTabsBar{display:flex;align-items:stretch;border-bottom:1px solid #e4eaf3;min-height:50px;background:#fafcff}\n .railTabs{display:flex;flex:1;min-width:0;overflow-x:auto;scrollbar-width:thin}\n .railTab{border:0;border-bottom:2px solid transparent;flex:1;min-width:0;background:transparent;color:inherit;font:inherit;font-size:12px;padding:8px 6px;cursor:pointer;white-space:normal}\n .railTab.selected{border-bottom-color:#2869dc;color:#195bb3;background:#eef5ff;font-weight:650}\n .railTab:hover{background:#edf4ff}\n .railToggle{flex:none;min-width:32px}\n .railTabContent{flex:1;min-height:0;min-width:0;overflow:auto;display:flex;flex-direction:column}\n .railTabContent .explorerPane{height:100%;padding:15px;flex:1;min-height:0;overflow:auto}\n .railTabContent .explorerToolbar{align-items:center;flex-wrap:wrap}\n .railTabContent .explorerToolbar h2{font-size:16px}\n .railTabContent .explorerActions{gap:5px}\n .railTabContent .fileEntry{gap:8px;padding:10px 7px}\n .railTabContent .fileActionButtons{gap:3px}\n .railTabContent .fileActionBtn{min-width:28px;height:30px;font-size:15px}\n .railPinsFull{overflow-y:auto;padding:12px;flex:1}\n .railPinRow{display:flex;align-items:flex-start;gap:4px;border-bottom:1px solid #e7edf5}\n .railPinRow .railPinnedItem{flex:1;min-width:0;font-size:13px;padding:12px 4px;white-space:pre-wrap}\n .railPinRow .railMini{flex:none}\n}\n";
css+='\n'+"\n/* More compact project and conversation entries, without shrinking toolbar controls. */\n@media(min-width:651px){\n .sidebar :is(button[data-act=\"project\"],.projectCard,.projectItem,.project-row),\n .convos :is(button[data-act=\"chat\"],button[data-act=\"convo\"],.convoCard,.convoItem,.convo-row){\n  padding-top:7px!important;padding-bottom:7px!important;min-height:0;\n }\n .sidebar :is(.projects,.projectList) > button,\n .convos :is(.convoList,.conversationsList) > button{padding-top:7px;padding-bottom:7px}\n}\n";
css+='\n'+"\n.fileMentionDialog{width:min(540px,95vw);max-height:80vh;padding:0;border:1px solid #dce4ef;border-radius:12px;background:var(--surface,#fff);color:inherit;box-shadow:0 20px 60px #0003}\n.fileMentionDialog::backdrop{background:#0008}\n.fileMentionHeader{display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid #e3e8f0;padding:14px 16px}\n.fileMentionLocation{padding:10px 16px;font-size:12px;opacity:.7;overflow-wrap:anywhere}\n.fileMentionList{overflow-y:auto;max-height:58vh;display:flex;flex-direction:column;padding:0 10px 12px}\n.fileMentionEntry{display:block;width:100%;padding:12px 10px;border:0;border-bottom:1px solid #edf0f5;background:transparent;text-align:left;overflow-wrap:anywhere;cursor:pointer;color:inherit}\n.fileMentionEntry:hover,.fileMentionEntry:focus-visible{background:#eef4fc}\n.fileMentionHint{padding:8px 12px;color:#68778b;font-size:13px}\n.inlineProjectFile{display:inline;border:0;border-radius:5px;padding:1px 3px;background:rgba(50,116,205,.1);color:#2566bb;text-decoration:underline;text-underline-offset:2px;cursor:pointer;font:inherit;overflow-wrap:anywhere}\n.inlineProjectFile:hover{background:rgba(50,116,205,.2)}\n";
css+='\n'+".explorerList{overflow:visible}\n.fileEntry{position:relative}\n.fileEntry:has(.fileMoreMenu[open]){z-index:6}\n.fileMoreMenu{position:relative;flex:none}\n.fileMoreMenu summary{list-style:none;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid #d4dbe6;border-radius:8px;cursor:pointer;font-size:22px;line-height:1;color:inherit}\n.fileMoreMenu summary::-webkit-details-marker{display:none}\n.fileMoreMenu summary:hover,.fileMoreMenu summary:focus-visible{background:rgba(120,140,160,.13)}\n.fileMorePanel{position:absolute;left:0;top:calc(100% + 5px);width:176px;padding:5px;background:var(--surface,#fff);color:inherit;border:1px solid #d4dbe6;border-radius:10px;box-shadow:0 10px 30px #0003;z-index:10;display:flex;flex-direction:column}\n.fileMorePanel button{border:0;border-radius:6px;padding:10px 12px;text-align:left;background:transparent;color:inherit;font:inherit;cursor:pointer}\n.fileMorePanel button:hover,.fileMorePanel button:focus-visible{background:rgba(120,140,160,.13)}\n.fileMorePanel .fileMoreDanger{color:#b33333}\n.filePinBtn.is-unpinned svg{transform:rotate(0deg)}\n.filePinBtn.is-pinned svg{transform:rotate(-35deg)}\n@media(max-width:650px){.fileEntry{gap:7px;padding:10px 8px}.fileEntryMeta{font-size:11px}.fileMorePanel{width:160px}}";
css+='\n'+"/* E8: unified readable type across conversation/project list, messages and file names. */\n.sidebar .navitem .navname,.convos .navitem .navname,.msgtext,.fileEntryNameAction,.railItemName,.railPinnedItem{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}\n.fileMorePanel button{font-family:Arial,Helvetica,sans-serif;font-size:14px}\n.fileEntryNameAction{font-weight:400}";
css+='\n'+"\n.voiceDraftPanel{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px;border-top:1px solid #e5e8ef;font:14px/1.5 Arial,Helvetica,sans-serif}\n.voiceDraftPanel audio{max-width:100%;height:36px;flex:1 1 160px}\n.voiceMic{font-size:18px;flex:none}\n.voiceDot{color:#de3942}\n.voiceMessage{display:flex;flex-direction:column;align-items:flex-start;gap:7px;font:14px/1.5 Arial,Helvetica,sans-serif}\n.voiceMessage audio{max-width:100%;width:min(290px,70vw);height:38px}\n@media(max-width:650px){.voiceDraftPanel{gap:6px}.voiceMic{min-width:35px}}\n";
writeFileSync(cssFile,css);
