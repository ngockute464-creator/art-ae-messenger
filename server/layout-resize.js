// Adjustable workspace columns. Stored per browser, no server state or extra requests.
const layoutKey='artae_workspace_columns_v1';
let layoutSizes={projects:290,conversations:250};
try{
 const previous=JSON.parse(localStorage.getItem(layoutKey)||'{}');
 for(const k of ['projects','conversations'])if(Number.isFinite(previous[k]))layoutSizes[k]=previous[k];
}catch{}
function layoutClamp(kind,value){
 const container=kind==='projects'?root.querySelector('.workspace'):root.querySelector('.split');
 const width=container?.getBoundingClientRect().width||window.innerWidth;
 const min=kind==='projects'?180:160;
 const max=Math.max(min,Math.min(kind==='projects'?460:420,width-(kind==='projects'?390:280)));
 return Math.round(Math.max(min,Math.min(max,value)));
}
function layoutApply(){
 if(window.matchMedia('(max-width: 650px)').matches)return;
 document.documentElement.style.setProperty('--project-col-width',layoutClamp('projects',layoutSizes.projects)+'px');
 document.documentElement.style.setProperty('--convo-col-width',layoutClamp('conversations',layoutSizes.conversations)+'px');
}
function layoutSet(kind,value,save=false){
 layoutSizes[kind]=layoutClamp(kind,value);
 layoutApply();
 if(save){try{localStorage.setItem(layoutKey,JSON.stringify(layoutSizes))}catch{}}
}
let layoutDrag=null;
root.addEventListener('pointerdown',event=>{
 const handle=event.target.closest('.columnGrip');
 if(!handle||window.matchMedia('(max-width: 650px)').matches)return;
 if(event.pointerType==='mouse'&&event.button!==0)return;
 const kind=handle.dataset.resize,container=kind==='projects'?root.querySelector('.workspace'):root.querySelector('.split');
 if(!container)return;
 event.preventDefault();
 const rect=container.getBoundingClientRect();
 layoutDrag={kind,left:rect.left,pointerId:event.pointerId,handle};
 handle.setPointerCapture?.(event.pointerId);
 document.body.classList.add('resizingColumns');
});
root.addEventListener('pointermove',event=>{
 if(!layoutDrag||layoutDrag.pointerId!==event.pointerId)return;
 layoutSet(layoutDrag.kind,event.clientX-layoutDrag.left);
});
function layoutEnd(event){
 if(!layoutDrag||layoutDrag.pointerId!==event.pointerId)return;
 layoutSet(layoutDrag.kind,layoutSizes[layoutDrag.kind],true);
 layoutDrag=null;
 document.body.classList.remove('resizingColumns');
}
root.addEventListener('pointerup',layoutEnd);
root.addEventListener('pointercancel',layoutEnd);
root.addEventListener('lostpointercapture',layoutEnd);
root.addEventListener('keydown',event=>{
 const handle=event.target.closest('.columnGrip');
 if(!handle||!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;
 event.preventDefault();
 const kind=handle.dataset.resize,step=event.shiftKey?30:10;
 layoutSet(kind,event.key==='Home'?(kind==='projects'?290:250):layoutSizes[kind]+(event.key==='ArrowRight'?step:-step),true);
});
root.addEventListener('dblclick',event=>{
 const handle=event.target.closest('.columnGrip');
 if(handle)layoutSet(handle.dataset.resize,handle.dataset.resize==='projects'?290:250,true);
});
window.addEventListener('resize',layoutApply);
layoutApply();
