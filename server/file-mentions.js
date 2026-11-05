// Project-file mentions: stored as portable text tokens; no Yandex URLs or tokens in chat.
const fileRefPrefix='@{file:';
const fileRefPattern=/@\{file:([0-9a-f-]{36}):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)\}/g;
function encodeFileRefText(value){
 const bytes=new TextEncoder().encode(value);
 let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
 return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeFileRefText(value){
 if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length>2500)throw Error('Неверная ссылка на файл');
 const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
 return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)));
}
function validProjectFileRef(p,path,name){
 return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p)&&
 typeof path==='string'&&path.length>0&&path.length<=500&&!path.startsWith('/')&&!path.endsWith('/')&&
 path.split('/').every(x=>x&&x!=='.'&&x!=='..'&&x.length<=120&&!/[\\\x00-\x1f]/.test(x))&&
 typeof name==='string'&&name.length>0&&name.length<=250;
}
function decorateFileReferences(html){
 if(!html.includes(fileRefPrefix))return html;
 const tpl=document.createElement('template');tpl.innerHTML=html;
 const walker=document.createTreeWalker(tpl.content,NodeFilter.SHOW_TEXT);
 const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
 for(const node of nodes){
  if(!node.nodeValue?.includes(fileRefPrefix))continue;
  if(node.parentElement?.closest('button,a,textarea,script,style'))continue;
  const text=node.nodeValue,fr=document.createDocumentFragment();
  fileRefPattern.lastIndex=0;let index=0,match,found=false;
  while((match=fileRefPattern.exec(text))!==null){
   const [full,refProject,path64,name64]=match;
   let path,name;try{path=decodeFileRefText(path64);name=decodeFileRefText(name64)}catch{continue}
   if(!validProjectFileRef(refProject,path,name))continue;
   fr.append(document.createTextNode(text.slice(index,match.index)));
   const link=document.createElement('button');
   link.type='button';link.className='inlineProjectFile';
   link.dataset.act='inlineProjectFile';
   link.dataset.project=refProject;link.dataset.path=path;link.dataset.name=name;
   link.textContent='📎 '+name;link.title='Открыть файл проекта: '+name;
   fr.append(link);index=match.index+full.length;found=true;
  }
  if(found){fr.append(document.createTextNode(text.slice(index)));node.replaceWith(fr)}
 }
 return tpl.innerHTML;
}
const originalFileMentionMessageView=messageView;
messageView=function(message){return decorateFileReferences(originalFileMentionMessageView(message))};
let fileMentionPicker=null;
function closeFileMentionPicker(){
 if(!fileMentionPicker)return;
 const ctx=fileMentionPicker;fileMentionPicker=null;
 if(ctx.dialog.open)ctx.dialog.close();ctx.dialog.remove();
 if(ctx.project===project&&ctx.convo===convo&&ctx.input.isConnected){
  ctx.input.focus();ctx.input.setSelectionRange(ctx.input.selectionStart,ctx.input.selectionStart);
 }
}
async function showFileMentionFolder(folder){
 const ctx=fileMentionPicker;if(!ctx)return;
 const request=++ctx.request;ctx.folder=folder;
 ctx.location.textContent=folder?'Файлы проекта / '+folder:'Файлы проекта';
 ctx.list.replaceChildren();
 const loading=document.createElement('p');loading.className='fileMentionHint';loading.textContent='Загрузка…';ctx.list.append(loading);
 try{
  const result=await explorerApi('list',{project:ctx.project,path:folder});
  if(fileMentionPicker!==ctx||ctx.request!==request)return;
  ctx.list.replaceChildren();
  const items=result.items||[];
  if(folder){
   const back=document.createElement('button');back.type='button';back.className='fileMentionEntry';back.textContent='← Назад';
   back.addEventListener('click',()=>showFileMentionFolder(folder.split('/').slice(0,-1).join('')));
   ctx.list.append(back);
  }
  for(const item of items){
   const isFolder=item.type==='folder';
   if(!isFolder&&item.type!=='file')continue;
   const line=document.createElement('button');line.type='button';line.className='fileMentionEntry';
   line.textContent=(isFolder?'📁 ':'📄 ')+item.name;
   line.title=isFolder?'Открыть папку':'Вставить ссылку на файл';
   line.addEventListener('click',()=>{
    if(fileMentionPicker!==ctx)return;
    if(isFolder)showFileMentionFolder(item.path);
    else{
     const token='@{file:'+ctx.project+':'+encodeFileRefText(item.path)+':'+encodeFileRefText(item.name)+'}';
     const input=ctx.input;
     if(input.isConnected&&project===ctx.project&&convo===ctx.convo){
      const value=input.value;
      // Use original @ position when still present; otherwise do not overwrite changed text.
      if(value.slice(ctx.at,ctx.at+1)==='@'){
       input.value=value.slice(0,ctx.at)+token+value.slice(ctx.at+1);
       const pos=ctx.at+token.length;input.focus();input.setSelectionRange(pos,pos);
       input.dispatchEvent(new Event('input',{bubbles:true}));
      }
     }
     closeFileMentionPicker();
    }
   });
   ctx.list.append(line);
  }
  if(!items.length){
   const empty=document.createElement('p');empty.className='fileMentionHint';empty.textContent='Папка пуста';ctx.list.append(empty);
  }
  if(result.hasMore){
   const more=document.createElement('p');more.className='fileMentionHint';
   more.textContent='Показана часть файлов. Перейдите в папку для уточнения выбора.';
   ctx.list.append(more);
  }
 }catch(e){
  if(fileMentionPicker!==ctx||ctx.request!==request)return;
  ctx.list.replaceChildren();
  const error=document.createElement('p');error.className='fileMentionHint';error.textContent=e.message||'Не удалось открыть папку';ctx.list.append(error);
  const retry=document.createElement('button');retry.type='button';retry.className='btn small';retry.textContent='Повторить';
  retry.addEventListener('click',()=>showFileMentionFolder(folder));ctx.list.append(retry);
 }
}
function openFileMentionPicker(input,at){
 if(fileMentionPicker)closeFileMentionPicker();
 if(!project||!convo)return;
 const dialog=document.createElement('dialog');dialog.className='fileMentionDialog';
 const head=document.createElement('div');head.className='fileMentionHeader';
 const heading=document.createElement('strong');heading.textContent='Вставить файл';
 const cancel=document.createElement('button');cancel.type='button';cancel.className='btn small';
 cancel.textContent='Отмена';cancel.addEventListener('click',closeFileMentionPicker);
 head.append(heading,cancel);
 const location=document.createElement('div');location.className='fileMentionLocation';
 const list=document.createElement('div');list.className='fileMentionList';
 dialog.append(head,location,list);document.body.append(dialog);
 fileMentionPicker={dialog,input,at,project,convo,request:0,location,list,folder:''};
 dialog.addEventListener('cancel',e=>{e.preventDefault();closeFileMentionPicker()});
 dialog.addEventListener('click',e=>{if(e.target===dialog)closeFileMentionPicker()});
 dialog.showModal();showFileMentionFolder('');
}
root.addEventListener('input',event=>{
 if(!['draft','editText'].includes(event.target?.id)||event.isComposing)return;
 if(event.inputType!=='insertText'||event.data!=='@')return;
 const input=event.target,at=input.selectionStart-1;
 if(at<0||input.value[at]!=='@')return;
 queueMicrotask(()=>{if(input.isConnected&&view==='chat'&&project&&convo)openFileMentionPicker(input,at)});
},true);
root.addEventListener('click',event=>{
 const link=event.target.closest('[data-act="inlineProjectFile"]');
 if(!link)return;
 event.preventDefault();event.stopImmediatePropagation();
 const linkedProject=link.dataset.project,path=link.dataset.path,name=link.dataset.name;
 if(!validProjectFileRef(linkedProject,path,name))return;
 if(project!==linkedProject){alert('Этот файл относится к другому проекту. Откройте исходный проект.');return}
 explorerPreview(path,name,'');
},true);
