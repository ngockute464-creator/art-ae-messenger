// Local PDF.js viewer: one lazily rendered page at a time, no native Android
// PDF intents, external document editors or third-party viewer services.
// The source URL is an authenticated same-origin stream with HTTP byte ranges.
let artaePdfLibrary=null;
async function artaeLoadPdfJs(){
 if(!artaePdfLibrary){
  artaePdfLibrary=import('/vendor/pdfjs/pdf.mjs').then(lib=>{
   lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs';
   if(typeof lib.getDocument!=='function')throw Error('PDF.js не загрузился');
   return lib;
  }).catch(err=>{artaePdfLibrary=null;throw err});
 }
 return artaePdfLibrary;
}
async function explorerPdfDocumentViewer(body,url,dialog){
 const toolbar=document.createElement('div');
 toolbar.className='artaePdfToolbar';
 const makeButton=(label,title,action)=>{
  const element=document.createElement('button');element.type='button';
  element.className='btn small';element.textContent=label;element.title=title;
  element.setAttribute('aria-label',title);
  element.addEventListener('click',action);return element;
 };
 const pageBox=document.createElement('input');
 pageBox.className='artaePdfPageNumber';pageBox.type='number';pageBox.min='1';pageBox.value='1';
 pageBox.setAttribute('aria-label','Номер страницы PDF');
 const total=document.createElement('span');total.className='artaePdfCount';total.textContent='/ …';
 const magnification=document.createElement('span');magnification.className='artaePdfZoom';
 magnification.textContent='100%';
 const search=document.createElement('input');search.type='search';
 search.className='artaePdfSearch';search.placeholder='Поиск в PDF';
 search.setAttribute('aria-label','Поиск текста по страницам PDF');
 const status=document.createElement('div');status.className='artaePdfStatus';
 status.setAttribute('role','status');status.textContent='Открываем документ…';
 const viewport=document.createElement('div');viewport.className='artaePdfViewport';
 const canvas=document.createElement('canvas');canvas.className='artaePdfCanvas';
 viewport.append(canvas);
 body.append(toolbar,status,viewport);
 let documentHandle=null,loadingTask=null,renderTask=null,renderSerial=0,searchSerial=0;
 let page=1,zoom=1,closed=false,loaded=false;
 const current=()=>documentHandle&&page>=1&&page<=documentHandle.numPages;
 const changePage=async(next)=>{
  if(!documentHandle||closed)return;
  page=Math.max(1,Math.min(documentHandle.numPages,Number(next)||1));
  pageBox.value=String(page);await renderPage();
 };
 const previous=makeButton('‹','Предыдущая страница',()=>{void changePage(page-1)});
 const next=makeButton('›','Следующая страница',()=>{void changePage(page+1)});
 const down=makeButton('−','Уменьшить PDF',()=>{zoom=Math.max(.5,zoom/1.2);void renderPage()});
 const up=makeButton('+','Увеличить PDF',()=>{zoom=Math.min(3.5,zoom*1.2);void renderPage()});
 const lookup=makeButton('Найти','Искать текст в PDF',()=>{void searchNext()});
 toolbar.append(previous,pageBox,total,next,down,magnification,up,search,lookup);
 pageBox.addEventListener('change',()=>{void changePage(pageBox.value)});
 search.addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();void searchNext()}
 });
 const stop=()=>{
  closed=true;searchSerial++;renderSerial++;
  renderTask?.cancel();
  if(loadingTask)void loadingTask.destroy().catch(()=>{});
 };
 dialog.addEventListener('close',stop,{once:true});
 async function renderPage(){
  if(!current()||closed)return;
  const serial=++renderSerial;
  if(renderTask){renderTask.cancel();try{await renderTask.promise}catch{}}
  try{
   status.textContent='Страница '+page+' из '+documentHandle.numPages+'…';
   const pdfPage=await documentHandle.getPage(page);
   if(closed||serial!==renderSerial)return;
   const intrinsic=pdfPage.getViewport({scale:1});
   const visibleWidth=Math.max(200,viewport.clientWidth-24);
   const fitting=Math.min(2,visibleWidth/Math.max(1,intrinsic.width));
   const requested=Math.min(4,Math.max(.2,fitting*zoom));
   const vp=pdfPage.getViewport({scale:requested});
   // Do not allocate a giant canvas on memory-constrained Android devices.
   const desiredPixelRatio=Math.min(2,window.devicePixelRatio||1);
   const resolution=Math.min(desiredPixelRatio,
    Math.sqrt(10000000/Math.max(1,vp.width*vp.height)));
   canvas.width=Math.max(1,Math.floor(vp.width*resolution));
   canvas.height=Math.max(1,Math.floor(vp.height*resolution));
   canvas.style.width=Math.round(vp.width)+'px';
   canvas.style.height=Math.round(vp.height)+'px';
   const ctx=canvas.getContext('2d',{alpha:false});
   if(!ctx)throw Error('Графический контекст PDF недоступен');
   renderTask=pdfPage.render({canvas,canvasContext:ctx,viewport:vp,
    transform:resolution!==1?[resolution,0,0,resolution,0,0]:undefined});
   await renderTask.promise;
   if(closed||serial!==renderSerial)return;
   previous.disabled=page<=1;next.disabled=page>=documentHandle.numPages;
   magnification.textContent=Math.round(zoom*100)+'%';
   status.textContent='';
   viewport.scrollTop=0;
  }catch(err){
   if(closed||serial!==renderSerial||err?.name==='RenderingCancelledException')return;
   status.textContent='Не удалось отобразить страницу: '+String(err?.message||err);
  }
 }
 async function searchNext(){
  const q=search.value.trim().toLocaleLowerCase('ru');
  if(!q||!documentHandle||closed)return;
  const serial=++searchSerial;
  lookup.disabled=true;
  try{
   // Search one page at a time, keeping memory bounded.
   for(let i=1;i<=documentHandle.numPages;i++){
    if(closed||serial!==searchSerial)return;
    const index=(page+i-1)%documentHandle.numPages+1;
    status.textContent='Поиск: страница '+index+' из '+documentHandle.numPages;
    const pdfPage=await documentHandle.getPage(index);
    const content=await pdfPage.getTextContent();
    const all=content.items.map(item=>item.str||'').join(' ').toLocaleLowerCase('ru');
    if(all.includes(q)){
     await changePage(index);
     if(!closed)status.textContent='Найдено на странице '+index;
     return;
    }
   }
   if(!closed)status.textContent='Текст не найден';
  }catch(e){if(!closed)status.textContent='Ошибка поиска: '+String(e?.message||e)}
  finally{lookup.disabled=false}
 }
 try{
  const pdfjs=await artaeLoadPdfJs();
  if(closed)return;
  loadingTask=pdfjs.getDocument({
   url,withCredentials:true,
   rangeChunkSize:131072,
   disableAutoFetch:true,
   isEvalSupported:false
  });
  documentHandle=await loadingTask.promise;
  if(closed){await loadingTask.destroy();return}
  loaded=true;
  total.textContent='/ '+documentHandle.numPages;
  pageBox.max=String(documentHandle.numPages);
  await renderPage();
 }catch(error){
  if(closed)return;
  status.textContent='Не удалось открыть PDF: '+String(error?.message||error);
 }
}
