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
const composerClient=readFileSync('server/composer-controls.js','utf8');
const voiceClient=readFileSync('server/voice-client.js','utf8');
const transcriptClient=readFileSync('server/transcript-client.js','utf8');
const chatFileClient=readFileSync('server/chat-file-client.js','utf8');
const chatMediaClient=readFileSync('server/chat-media-client.js','utf8');
const messageMenuClient=readFileSync('server/message-menu-client.js','utf8');
const focusGuardClient=readFileSync('server/composer-focus-guard.js','utf8');
replace('function cp(){',client+'\n'+resizeClient+'\n'+uxClient+'\n'+mentionsClient+'\n'+officeClient+'\n'+reliableSend+'\n'+composerClient+'\n'+voiceClient+'\n'+transcriptClient+'\n'+chatFileClient+'\n'+chatMediaClient+'\n'+messageMenuClient+'\n'+focusGuardClient+'\nfunction cp(){','client and resize functions');

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
        "if(action==='filesHome')openExplorer();else if(action==='filesReload')explorerLoad(explorer.path);else if(action==='filesOpen')explorerLoad(el.dataset.path);else if(action==='filesUp')explorerLoad(explorer.path.split('/').slice(0,-1).join('/'));else if(action==='filesMkdir')explorerMkdir();else if(action==='filesUpload')root.querySelector('#explorerUpload')?.click();else if(action==='filesDelete')explorerDelete(el.dataset.path,el.dataset.name);else if(action==='filesDownload')explorerDownload(el.dataset.path,el.dataset.name);else if(action==='filesPreview')explorerPreview(el.dataset.path,el.dataset.name,el.dataset.mime,null,el);else if(action==='project')openProject(id);",
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
replace("if(action==='retrySend'){retryOutgoing(id);return}","if(action==='voiceTranscribe'){voiceTranscribe(id);return}else if(action==='voiceTranscriptCopy'){voiceTranscriptCopy(id);return}else if(action==='voiceStart'){voiceStart();return}else if(action==='voiceStop'){voiceStop();return}else if(action==='voiceCancel'){voiceCancel();return}else if(action==='voiceSend'){voiceSend();return}else if(action==='voicePlay'){voicePlay(id);return}else if(action==='retrySend'){retryOutgoing(id);return}",'voice actions');

// E12: consistent composer icons, one-line input and concise placeholder.
replace('<button type="button" class="btn" data-act="upload" title="Добавить файл">📎</button>',
        '<button type="button" class="btn composerAttach" data-act="upload" title="Прикрепить файл" aria-label="Прикрепить файл"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5L13.2 2.3a4 4 0 0 1 5.7 5.7L9.3 17.6a2 2 0 0 1-2.8-2.8l9-9"/></svg></button>',
        'composer attachment icon');
replace('<button class="btn primary" type="submit">Отправить</button>',
        '<button class="btn primary composerSend" type="submit" ${composerHasSendableText()?"":"hidden"} title="Отправить сообщение" aria-label="Отправить сообщение"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button>',
        'composer submit icon');
replace('rows="2" placeholder="Сообщение или пояснение к файлу..."',
        'rows="1" placeholder="Сообщение..."',
        'composer prompt and rows');

// E15: message edit controls in a single row, preserving existing handlers.
replace('<button class="btn small" type="button" data-act="addEditFile">',
        '<div class="editActions"><button class="btn small" type="button" data-act="addEditFile">',
        'message edit attach inline');
replace('</button><div class="editActions"><button class="btn primary" type="submit">Сохранить изменения</button>',
        '</button><button class="btn primary" type="submit">Сохранить</button>',
        'message edit save inline');
// E16 — replace the former upload placeholder.
const chatUploadStub=app.match(/else if\(action==='upload'\)alert\('[^']*'\);/);
if(!chatUploadStub)throw Error('Chat attachment placeholder not found');
app=app.replace(chatUploadStub[0],"else if(action==='upload')chatFilePick();");
replace('${voiceMessageHtml(m)}','${chatFileMessageHtml(m)}','chat attachment message renderer');
replace('${getDraft().files.map((f,i)=>','${chatFileDraftHtml()}${getDraft().files.map((f,i)=>','chat attachment draft chips');
// A freshly rendered chat restores its scroll position in requestAnimationFrame.
// That programmatic scroll fires 'scroll' and used to close the message menu
// immediately after a click (visible as a brief flash on desktop and Safari).
// Keep dismissal by outside click and Escape, but do not dismiss on any scroll.
replace("root.addEventListener('scroll',e=>{if(openMenu!==null && e.target?.id==='msgscroll'){openMenu=null;render()}},true);",
        "/* Message menu remains open during render-driven scroll. Outside click and Escape close it. */",
        'message menu survives programmatic scroll');
// Show edit/delete action menus only on messages and legacy file cards belonging
// to the signed-in user. Other users' messages remain readable and pinnable via
// shared pin UI; no one gains edit or delete privileges through this change.
replace("${actionMenu('message:'+m.id,objectActions('message',m.id,c.id,mine))}",
        "${mine?actionMenu('message:'+m.id,objectActions('message',m.id,c.id,mine)):''}",
        'message actions restricted to author');
replace("${actionMenu('file:'+f.id,objectActions('file',f.id,c.id,mine))}",
        "${mine?actionMenu('file:'+f.id,objectActions('file',f.id,c.id,mine)):''}",
        'file actions restricted to author');
replace("if(action==='toggleMenu'){openMenu=openMenu===el.dataset.menu?null:el.dataset.menu;render();return}",
        "if(action==='toggleMenu'){toggleMessageMenuDom(el);return}",
        'message menu DOM toggle without render');
replace("const dropdown=activeButton.closest('.menuWrap')?.querySelector('.actionDropdown');",
        "const dropdown=activeButton.closest('.menuWrap')?.querySelector('.actionDropdown')||root.querySelector('.app > .actionDropdown');",
        'portal dropdown remains positionable after move');
replace("holdTimer=setTimeout(()=>{openMenu=key;holdTriggered=true;render()},550);",
        "holdTimer=setTimeout(()=>{const button=[...root.querySelectorAll('.moreBtn')].find(b=>b.dataset.menu===key);if(button){toggleMessageMenuDom(button);holdTriggered=true}},550);",
        'touch long-press opens without rerender');
replace("if(btn){e.preventDefault();openMenu=btn.dataset.menu;render()}",
        "if(btn){e.preventDefault();toggleMessageMenuDom(btn)}",
        'touch context menu opens without rerender');
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
css+='\n'+".voiceTranscriptActions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}\n.voiceTranscriptText{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;font:14px/1.55 Arial,Helvetica,sans-serif;padding:8px 0}\n.voiceTranscriptError{font-size:12px;color:#b03a3a;overflow-wrap:anywhere}\n.voiceTranscriptCopy{font-size:12px}";
css+='\n'+"\n/* E11: one-line compact voice playback/transcription controls. */\n.voiceMessage{display:flex;flex-direction:column;align-items:flex-start;gap:5px;max-width:100%;min-width:0}\n.voiceMessageRow{display:flex;flex-wrap:nowrap;align-items:center;gap:9px;max-width:100%;min-width:0}\n.voiceSpeaker{flex:none;font-size:17px;line-height:1}\n.voiceTime{flex:none;font:14px/1.4 Arial,Helvetica,sans-serif;white-space:nowrap;font-variant-numeric:tabular-nums}\n.voicePlayIcon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:30px;height:30px;border:1px solid #d4dbe6;border-radius:8px;background:transparent;color:inherit;font:16px/1 Arial,Helvetica,sans-serif;cursor:pointer}\n.voicePlayIcon:hover,.voicePlayIcon:focus-visible{background:rgba(120,140,160,.13)}\n.voicePlayIcon:disabled{opacity:.5;cursor:default}\n.voiceTranscriptTrigger{white-space:nowrap;font:13px/1.3 Arial,Helvetica,sans-serif;min-height:30px}\n.voiceTranscriptProgress{display:block;flex:0 1 110px;width:110px;min-width:50px;height:9px;accent-color:#159447}\n.voiceTranscriptText{align-self:stretch}\n@media(max-width:650px){.voiceMessageRow{gap:6px}.voiceTranscriptProgress{width:70px;flex-basis:70px}}\n";
css+='\n'+"\n/* E12: equal-sized buttons, input and SVG icons on desktop and mobile. */\n.composeLine{display:flex;align-items:center;gap:8px}\n.composeLine > button.btn{flex:0 0 40px;box-sizing:border-box;width:40px;min-width:40px;height:40px;min-height:40px;padding:0;display:inline-flex;align-items:center;justify-content:center;line-height:1;border-radius:10px}\n.composeLine > button.btn svg{display:block;flex:none;width:22px;height:22px}\n.composeLine > button.composerSend,.composeLine > button.composerSend:hover{background:transparent;border-color:transparent;color:#2869dc}\n.composeLine > button.composerSend:hover{background:rgba(40,105,220,.09)}\n.composeLine > textarea#draft{box-sizing:border-box;flex:1 1 auto;width:100%;min-width:0;height:40px;min-height:40px;max-height:110px;padding:9px 11px;margin:0;line-height:20px;font:14px/20px Arial,Helvetica,sans-serif;resize:none}\n@media(max-width:650px){.composeLine{gap:6px}.composeLine > button.btn{width:40px;min-width:40px;height:40px;min-height:40px;padding:0}.composeLine > textarea#draft{min-height:40px;height:40px;padding:9px 10px}}\n";
css+='\n'+"\n.messageEdit .editActions{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;width:100%;max-width:100%;overflow-x:auto;padding-top:8px}\n.messageEdit .editActions .btn{flex:0 0 auto;white-space:nowrap;font:13px/1.3 Arial,Helvetica,sans-serif;min-height:36px;padding:7px 10px}\n@media(max-width:650px){.messageEdit .editActions{gap:5px}.messageEdit .editActions .btn{font-size:12px;padding:7px 8px}}\n";
css+='\n'+"\n.chatStoredFiles{display:flex;flex-direction:column;align-items:flex-start;gap:5px;margin-top:5px;max-width:100%}\n.chatStoredFile{display:flex;align-items:center;gap:8px;max-width:100%;padding:7px 9px;border:1px solid #d4dbe6;border-radius:9px;background:transparent;color:inherit;text-align:left;cursor:pointer}\n.chatStoredFile:hover{background:rgba(120,140,160,.09)}\n.chatStoredFileName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px}\n.chatStoredFileSize{font-size:11px;white-space:nowrap;opacity:.65}\n.chatFileCaption{white-space:pre-wrap;overflow-wrap:anywhere}\n";
css+='\n'+String.raw`
/* E17: field -> paperclip -> contextual mic/send. */
.composeLine{position:relative;align-items:flex-end}
.composeLine>textarea#draft{order:0;flex:1 1 0%;align-self:center;overflow-y:auto;max-height:128px}
.composeLine>.composerAttach{order:1}
.composeLine>.voiceMic,.composeLine>.composerSend{order:2}
.composeLine>button[hidden],.composeLine>.voiceHoldStatus[hidden]{display:none!important}
.composeLine>.voiceMic{touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer}
.composeLine>.voiceHoldStatus{order:0;display:flex;align-items:center;flex:1 1 0%;min-width:0;min-height:40px;gap:8px;white-space:nowrap;overflow:hidden;font:14px/20px Arial,Helvetica,sans-serif}
.voiceHoldTimer{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
.voiceHoldHint{color:#69788c;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;font-size:12px}
.voiceHoldStatus .voiceDot{font-size:22px;line-height:1;animation:artaeVoicePulse .85s infinite alternate}
@keyframes artaeVoicePulse{from{opacity:1}to{opacity:.25}}
.composeLine.voice-holding>textarea#draft,.composeLine.voice-holding>.composerAttach,
.composeLine.voice-holding>.composerSend{display:none!important}
.composeLine.voice-holding>.voiceHoldStatus{display:flex!important}
.composeLine.voice-holding>.voiceMic{background:#1677e8;color:#fff;border-color:#1677e8;border-radius:50%;transform:scale(1.12);box-shadow:0 0 0 7px rgba(22,119,232,.12);z-index:1}
.composeLine.voice-canceling>.voiceHoldStatus .voiceHoldHint{color:#d02b41}
.composeLine.voice-canceling>.voiceMic{background:#d02b41;border-color:#d02b41}
@media(max-width:650px){.composeLine>.voiceHoldStatus{gap:6px}.voiceHoldHint{font-size:12px}}
`;
css+='\n'+String.raw`
/* Media previews fit the chat; originals remain at full resolution on Disk. */
.chatStoredFiles{align-items:stretch!important;max-width:100%}
.chatMediaThumb{display:flex;position:relative;flex-direction:column;align-items:stretch;overflow:hidden;width:min(380px,100%);max-width:100%;padding:0;border:1px solid #dce3ee;border-radius:12px;color:inherit;background:var(--surface,#fff);cursor:pointer;text-align:left}
.chatMediaVisual{display:flex;position:relative;min-height:105px;max-height:260px;align-items:center;justify-content:center;overflow:hidden;background:#edf2f8}
.chatMediaThumb[data-chat-kind="video"] .chatMediaVisual{background:#1c273a}
.chatMediaVisual img,.chatMediaVisual video{display:block;width:100%;height:auto;max-height:260px;object-fit:contain}
.chatMediaVisual video{aspect-ratio:16/9}
.chatMediaPlay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;place-items:center;width:50px;height:50px;border-radius:50%;background:#0009;color:white;font-size:24px;pointer-events:none}
.chatMediaCaption{display:flex;align-items:center;gap:8px;padding:8px 10px;font:13px/1.4 Arial,Helvetica,sans-serif;min-width:0}
.chatMediaCaptionName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.chatMediaCaptionSize{flex:none;white-space:nowrap;color:#7b8795;font-size:11px}
.chatMediaLoading{position:absolute;inset:0;display:grid;place-items:center;background:#edf2f8e6;color:#53647a;font:13px Arial,Helvetica,sans-serif}
.chatMediaThumb[data-chat-kind="video"] .chatMediaLoading{background:#1b2939e6;color:#dbe8f7}
.chatMediaThumb.chatMediaReady .chatMediaLoading{display:none}
.chatMediaThumb.chatMediaError .chatMediaLoading{background:#eeeaf0;color:#933e4b}
.chatMediaPicker{width:min(540px,94vw);max-height:min(85vh,730px);padding:0;border:1px solid #dce3ed;border-radius:13px;background:var(--surface,#fff);color:inherit;box-shadow:0 18px 55px #0005}
.chatMediaPicker::backdrop{background:#0009}
.chatMediaPickerHeader{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid #e2e8f0}
.chatMediaPickerBody{padding:12px 16px;display:flex;flex-direction:column;gap:10px;max-height:65vh;overflow:auto}
.chatMediaPickerFolder{display:flex;flex-direction:column;gap:3px;max-height:32vh;overflow:auto;border:1px solid #e4e9f1;border-radius:8px;padding:5px}
.chatMediaPickerFolder button{border:0;background:transparent;text-align:left;padding:10px 8px;color:inherit;font:inherit;cursor:pointer;border-radius:6px}
.chatMediaPickerFolder button:hover,.chatMediaPickerFolder button:focus-visible{background:#e8f1ff;color:#184d9e}
.chatMediaPickerName{box-sizing:border-box;width:100%;min-height:41px;padding:8px 10px;border:1px solid #cbd6e4;border-radius:8px;font:inherit;color:inherit;background:var(--surface,#fff)}
.chatMediaPickerFooter{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid #e2e8f0}
.chatMediaPickerStatus{font-size:12px;color:#58677a;overflow-wrap:anywhere}
.filePreviewHeader .chatMediaSaveAction{white-space:nowrap}
@media(max-width:650px){.chatMediaThumb{width:min(100%,380px)}.chatMediaVisual{max-height:215px}.chatMediaVisual img,.chatMediaVisual video{max-height:215px}.chatMediaPickerFooter{padding:10px}}
`;
css+='\n'+String.raw`
/* Dedicated viewer header and toolbar. Never force long filenames into a
   one-character column beside media controls on narrow Android screens. */
.filePreviewDialog[open]{
 display:flex;flex-direction:column;box-sizing:border-box;
 width:min(900px,96vw);max-width:96vw;
 max-height:92vh;max-height:92dvh;overflow:hidden;
}
.filePreviewDialog .filePreviewHeader{
 display:flex;flex:0 0 auto;min-width:0;min-height:50px;
 align-items:center;gap:10px;padding:10px 14px;box-sizing:border-box;
}
.filePreviewDialog .filePreviewTitle{
 display:block;flex:1 1 auto;min-width:0;max-width:100%;
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
 overflow-wrap:normal;word-break:normal;line-height:1.35;
}
.filePreviewDialog .filePreviewClose{flex:0 0 auto;margin-left:auto}
.filePreviewDialog .filePreviewToolbar{
 display:flex;flex:0 0 auto;align-items:center;justify-content:flex-end;
 flex-wrap:wrap;gap:8px;box-sizing:border-box;
 min-width:0;padding:8px 14px;border-bottom:1px solid #dce1e9;
}
.filePreviewDialog .filePreviewToolbar:empty{display:none}
.filePreviewDialog .chatMediaSaveAction{flex:0 0 auto;white-space:nowrap;margin-right:auto}
.filePreviewDialog .fileZoomTools{
 display:flex;flex:0 0 auto;align-items:center;gap:4px;
 margin-left:auto;margin-right:0;
}
.filePreviewDialog .fileZoomTools button{flex:0 0 auto;min-width:36px}
.filePreviewDialog .filePreviewBody{
 flex:1 1 auto;min-width:0;min-height:0;max-height:none;
 box-sizing:border-box;overflow:auto;
}
.filePreviewDialog .fileImageViewport{
 width:100%;max-width:100%;box-sizing:border-box;
 height:min(66vh,720px);min-height:180px;
}
@media(max-width:650px){
 .filePreviewDialog[open]{
  width:calc(100vw - 24px);max-width:calc(100vw - 24px);
  max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);
 }
 .filePreviewDialog .filePreviewHeader{padding:10px 12px;min-height:48px}
 .filePreviewDialog .filePreviewTitle{font-size:15px}
 .filePreviewDialog .filePreviewToolbar{padding:8px 10px;gap:6px}
 .filePreviewDialog .chatMediaSaveAction{font-size:12px}
 .filePreviewDialog .filePreviewBody{padding:8px}
 .filePreviewDialog .fileImageViewport{height:min(62vh,570px);height:min(62dvh,570px);min-height:180px}
}
`;
css+='\n'+String.raw`
/* When the device cannot decode a video, offer the intact original. */
.fileVideoError{margin:12px 0 4px;padding:12px;border:1px solid #ead7ba;
 border-radius:10px;background:#fff8ed;color:#553f23;line-height:1.5}
.fileVideoError p{margin:0 0 8px}
.fileVideoError a{display:inline-flex;align-items:center;min-height:36px}
`;
writeFileSync(cssFile,css);
