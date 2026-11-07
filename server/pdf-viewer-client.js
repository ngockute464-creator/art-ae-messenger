// Local PDF.js viewer. "Страницы" keeps the existing single-page mode;
// "Лента" scrolls continuously, rendering only nearby pages. The PDF bytes
// remain in the same-origin, authenticated, HTTP-range-capable source.
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
 let page=1,zoom=1,closed=false,mode='single',modeSerial=0;
 let scrollSlots=[],scrollEntries=new Map(),scrollScheduled=false,estimateRatio=1.414;
 const MAX_SCROLL_CANVASES=3;
 const current=()=>documentHandle&&page>=1&&page<=documentHandle.numPages;
 const isScroll=()=>mode==='scroll'&&!closed;
 const redraw=()=>{
  magnification.textContent=Math.round(zoom*100)+'%';
  if(!documentHandle||closed)return;
  if(mode==='single')void renderPage();
  else{
   const keepPage=page;
   clearScrollCanvases();
   const estimate=estimatedSheetHeight();
   for(const slot of scrollSlots){slot.style.height='';slot.style.minHeight=estimate+'px'}
   scrollToPage(keepPage);
  }
 };
 const changePage=async(next)=>{
  if(!documentHandle||closed)return;
  page=Math.max(1,Math.min(documentHandle.numPages,Number(next)||1));
  pageBox.value=String(page);
  if(mode==='scroll')scrollToPage(page);
  else await renderPage();
 };
 const previous=makeButton('‹','Предыдущая страница',()=>{void changePage(page-1)});
 const next=makeButton('›','Следующая страница',()=>{void changePage(page+1)});
 const down=makeButton('−','Уменьшить PDF',()=>{zoom=Math.max(.5,zoom/1.2);redraw()});
 const up=makeButton('+','Увеличить PDF',()=>{zoom=Math.min(3.5,zoom*1.2);redraw()});
 const lookup=makeButton('Найти','Искать текст в PDF',()=>{void searchNext()});
 const modeButton=makeButton('Лента','Непрерывная прокрутка PDF',()=>{void switchMode()});
 modeButton.className+=' artaePdfModeButton';
 modeButton.setAttribute('aria-pressed','false');
 toolbar.append(previous,pageBox,total,next,down,magnification,up,modeButton,search,lookup);
 pageBox.addEventListener('change',()=>{void changePage(pageBox.value)});
 search.addEventListener('keydown',event=>{
  if(event.key==='Enter'){event.preventDefault();void searchNext()}
 });
 const stop=()=>{
  closed=true;searchSerial++;renderSerial++;modeSerial++;
  renderTask?.cancel();
  clearScrollCanvases();
  viewport.removeEventListener('scroll',onScroll);
  if(loadingTask)void loadingTask.destroy().catch(()=>{});
 };
 dialog.addEventListener('close',stop,{once:true});

 async function renderPage(){
  if(!current()||closed||mode!=='single')return;
  const serial=++renderSerial;
  const previousTask=renderTask;
  if(previousTask){previousTask.cancel();try{await previousTask.promise}catch{}}
  if(closed||mode!=='single'||serial!==renderSerial)return;
  try{
   status.textContent='Страница '+page+' из '+documentHandle.numPages+'…';
   const pdfPage=await documentHandle.getPage(page);
   if(closed||mode!=='single'||serial!==renderSerial)return;
   const intrinsic=pdfPage.getViewport({scale:1});
   const visibleWidth=Math.max(200,viewport.clientWidth-24);
   const fitting=Math.min(2,visibleWidth/Math.max(1,intrinsic.width));
   const requested=Math.min(4,Math.max(.2,fitting*zoom));
   const vp=pdfPage.getViewport({scale:requested});
   // Limit Android allocation to 10 megapixels for the single page.
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
   if(closed||mode!=='single'||serial!==renderSerial)return;
   previous.disabled=page<=1;next.disabled=page>=documentHandle.numPages;
   magnification.textContent=Math.round(zoom*100)+'%';
   status.textContent='';
   viewport.scrollTop=0;
  }catch(err){
   if(closed||mode!=='single'||serial!==renderSerial||err?.name==='RenderingCancelledException')return;
   status.textContent='Не удалось отобразить страницу: '+String(err?.message||err);
  }
 }

 // Placeholders occupy the full scrollable height, but at most three sheets
 // contain rasterized canvases. Offscreen canvases are cancelled and released.
 function estimatedSheetHeight(){
  return Math.max(110,Math.round(Math.max(200,viewport.clientWidth-36)*estimateRatio*zoom)+56);
 }
 function releaseScrollCanvas(number){
  const entry=scrollEntries.get(number);
  if(!entry)return;
  scrollEntries.delete(number);
  entry.cancelled=true;
  entry.task?.cancel();
  if(entry.canvas){
   entry.canvas.remove();
   entry.canvas.width=0;entry.canvas.height=0;
  }
  scrollSlots[number-1]?.classList.remove('artaePdfSheetReady');
 }
 function clearScrollCanvases(){
  for(const n of [...scrollEntries.keys()])releaseScrollCanvas(n);
 }
 function pageAtOffset(y){
  let lo=0,hi=scrollSlots.length-1;
  while(lo<=hi){
   const mid=(lo+hi)>>1,slot=scrollSlots[mid];
   if(y<slot.offsetTop)hi=mid-1;
   else if(y>=slot.offsetTop+slot.offsetHeight)lo=mid+1;
   else return mid+1;
  }
  return Math.max(1,Math.min(scrollSlots.length,lo+1));
 }
 function scheduleScroll(){
  if(!isScroll()||scrollScheduled)return;
  scrollScheduled=true;
  requestAnimationFrame(()=>{
   scrollScheduled=false;
   if(isScroll())syncScrollWindow();
  });
 }
 function onScroll(){scheduleScroll()}
 function syncScrollWindow(){
  if(!isScroll()||!scrollSlots.length)return;
  const first=pageAtOffset(viewport.scrollTop+12);
  const last=pageAtOffset(viewport.scrollTop+viewport.clientHeight-12);
  page=first;
  pageBox.value=String(page);
  previous.disabled=page<=1;next.disabled=page>=documentHandle.numPages;
  // Prioritize pages actually in view, then the page just after the viewport.
  const candidates=[];
  for(let i=first;i<=Math.min(last,first+MAX_SCROLL_CANVASES-1);i++)candidates.push(i);
  for(let i=last+1;i<=documentHandle.numPages&&candidates.length<MAX_SCROLL_CANVASES;i++)candidates.push(i);
  for(let i=first-1;i>=1&&candidates.length<MAX_SCROLL_CANVASES;i--)candidates.push(i);
  const keep=new Set(candidates);
  for(const number of [...scrollEntries.keys()])if(!keep.has(number))releaseScrollCanvas(number);
  for(const number of candidates)if(!scrollEntries.has(number))void renderScrollSheet(number);
 }
 function scrollToPage(number){
  if(!isScroll()||!scrollSlots.length)return;
  const slot=scrollSlots[number-1];if(!slot)return;
  const offset=slot.getBoundingClientRect().top-viewport.getBoundingClientRect().top;
  viewport.scrollTop=Math.max(0,viewport.scrollTop+offset-8);
  page=number;pageBox.value=String(number);
  syncScrollWindow();
 }
 async function renderScrollSheet(number){
  if(!isScroll()||scrollEntries.has(number))return;
  const slot=scrollSlots[number-1],token=modeSerial;
  if(!slot)return;
  const sheetCanvas=document.createElement('canvas');
  sheetCanvas.className='artaePdfCanvas';
  const entry={canvas:sheetCanvas,task:null,cancelled:false};
  scrollEntries.set(number,entry);
  slot.append(sheetCanvas);
  const valid=()=>isScroll()&&modeSerial===token&&!entry.cancelled&&scrollEntries.get(number)===entry;
  try{
   const pdfPage=await documentHandle.getPage(number);
   if(!valid())return;
   const base=pdfPage.getViewport({scale:1});
   const fitting=Math.min(2,Math.max(200,viewport.clientWidth-36)/Math.max(1,base.width));
   const vp=pdfPage.getViewport({scale:Math.min(4,Math.max(.2,fitting*zoom))});
   // Total canvas budget: at most 3 * 4MP (approximately 48MB of pixels).
   const pixelRatio=Math.min(2,window.devicePixelRatio||1);
   const resolution=Math.min(pixelRatio,Math.sqrt(4000000/Math.max(1,vp.width*vp.height)));
   sheetCanvas.width=Math.max(1,Math.floor(vp.width*resolution));
   sheetCanvas.height=Math.max(1,Math.floor(vp.height*resolution));
   sheetCanvas.style.width=Math.round(vp.width)+'px';
   sheetCanvas.style.height=Math.round(vp.height)+'px';
   slot.style.height=Math.round(vp.height+56)+'px';
   const ctx=sheetCanvas.getContext('2d',{alpha:false});
   if(!ctx)throw Error('Не удалось создать поверхность PDF');
   entry.task=pdfPage.render({canvas:sheetCanvas,canvasContext:ctx,viewport:vp,
    transform:resolution!==1?[resolution,0,0,resolution,0,0]:undefined});
   await entry.task.promise;
   if(!valid())return;
   slot.classList.add('artaePdfSheetReady');
   scheduleScroll();
  }catch(err){
   if(!valid()||err?.name==='RenderingCancelledException')return;
   slot.querySelector('.artaePdfSheetLabel').textContent='Ошибка страницы '+number;
  }
 }
 async function switchMode(){
  if(!documentHandle||closed)return;
  const nextMode=mode==='single'?'scroll':'single';
  mode=nextMode;const token=++modeSerial;
  modeButton.textContent=mode==='single'?'Лента':'Страницы';
  modeButton.title=mode==='single'?'Непрерывная прокрутка PDF':'Постраничный просмотр PDF';
  modeButton.setAttribute('aria-label',modeButton.title);
  modeButton.setAttribute('aria-pressed',String(mode==='scroll'));
  status.textContent='';
  if(mode==='single'){
   clearScrollCanvases();
   scrollSlots=[];scrollScheduled=false;
   viewport.removeEventListener('scroll',onScroll);
   viewport.classList.remove('artaePdfContinuous');
   viewport.replaceChildren(canvas);
   await renderPage();
   return;
  }
  ++renderSerial;
  renderTask?.cancel();
  viewport.classList.add('artaePdfContinuous');
  viewport.replaceChildren();
  try{
   const firstPage=await documentHandle.getPage(1);
   if(closed||mode!=='scroll'||modeSerial!==token)return;
   const size=firstPage.getViewport({scale:1});
   estimateRatio=size.height/Math.max(1,size.width);
   const fragment=document.createDocumentFragment();
   scrollSlots=[];
   const height=estimatedSheetHeight();
   for(let i=1;i<=documentHandle.numPages;i++){
    const slot=document.createElement('div');
    slot.className='artaePdfSheet';slot.dataset.page=String(i);
    slot.style.minHeight=height+'px';
    slot.setAttribute('aria-label','Страница PDF '+i);
    const caption=document.createElement('div');
    caption.className='artaePdfSheetLabel';caption.textContent='Страница '+i;
    slot.append(caption);fragment.append(slot);scrollSlots.push(slot);
   }
   viewport.append(fragment);
   viewport.addEventListener('scroll',onScroll,{passive:true});
   scrollToPage(page);
  }catch(err){
   if(!closed&&mode==='scroll'&&modeSerial===token)
    status.textContent='Не удалось включить прокрутку: '+String(err?.message||err);
  }
 }

 async function searchNext(){
  const q=search.value.trim().toLocaleLowerCase('ru');
  if(!q||!documentHandle||closed)return;
  const serial=++searchSerial;
  lookup.disabled=true;
  try{
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
  total.textContent='/ '+documentHandle.numPages;
  pageBox.max=String(documentHandle.numPages);
  await renderPage();
 }catch(error){
  if(closed)return;
  status.textContent='Не удалось открыть PDF: '+String(error?.message||error);
 }
}

// Public bridge for bundled and standalone Office clients. Reuses exactly
// the same local PDF.js controls as ordinary project PDF files.
window.ARTAE_PDF_RENDER=explorerPdfDocumentViewer;
