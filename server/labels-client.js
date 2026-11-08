// PostgreSQL is the sole source of truth for project labels.
let labelsProject=null,labelsBusy=false,labelsLastFetch=0,labelsPending=false;
function labelOwner(kind,item){
 if(kind==='message'){
  const m=data.messages.find(m=>m.id===item);
  const pin=data.pins.find(p=>p.kind==='message'&&p.item===item&&p.convoId);
  const convoId=m?.convo||pin?.convoId;
  return data.convos.find(c=>c.id===convoId)?.project||null;
 }
 if(kind==='file'){
  const f=data.files.find(f=>f.id===item);
  if(f){
   const m=data.messages.find(m=>m.id===f.message);
   return data.convos.find(c=>c.id===m?.convo)?.project||null;
  }
  if(data.pins.some(p=>p.kind==='file'&&p.item===item&&p.project===project))return project;
 }
 return null;
}
async function labelsRequest(action,payload={},get=false){
 const url='/.netlify/functions/labels';
 const response=await fetch(get?url+'?'+new URLSearchParams(payload):url,{
  credentials:'same-origin',cache:'no-store',
  ...(get?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})})
 });
 let result={};try{result=await response.json()}catch{}
 if(!response.ok){const error=Error(result.error||'Не удалось синхронизировать метки');error.status=response.status;throw error}
 return result;
}
async function refreshSharedLabels(force=false){
 const target=project;
 if(!target||!document.body)return;
 if(labelsBusy){if(force||labelsProject!==target)labelsPending=true;return}
 if(!force&&target===labelsProject&&Date.now()-labelsLastFetch<5000)return;
 labelsBusy=true;
 try{
  const response=await labelsRequest('',{project:target},true);
  if(project!==target)return;
  const shared=(response.labels||[]).map(l=>({...l,project:target}));
  // Drop stale copies of this project's labels, not labels for other projects.
  data.labels=data.labels.filter(l=>l.project!==target).concat(shared);
  labelsProject=target;labelsLastFetch=Date.now();
  if(!modal&&!editing&&document.activeElement?.id!=='draft')render();
 }catch(error){console.warn('Shared labels:',error.message)}
 finally{
  labelsBusy=false;
  if(labelsPending||(project&&project!==target)){
   labelsPending=false;
   queueMicrotask(()=>void refreshSharedLabels(true));
  }
 }
}
async function saveSharedLabels(kind,item,text,originalText){
 const target=labelOwner(kind,item)||project;
 if(!target)throw Error('Проект метки не определён');
 const names=[...new Set(String(text).split(',').map(n=>n.trim()).filter(Boolean))].slice(0,12);
 if(names.some(n=>n.length>40))throw Error('Метка длиннее 40 символов');
 const expectedNames=[...new Set(String(originalText??'').split(',').map(n=>n.trim()).filter(Boolean))];
 try{await labelsRequest('set',{project:target,kind,item,names,expectedNames})}
 catch(error){if(error.status===409)await refreshSharedLabels(true);throw error}
 data.labels=data.labels.filter(l=>!(l.project===target&&l.kind===kind&&l.item===item));
 for(const name of names)data.labels.push({kind,item,name,project:target});
 labelsProject=target;labelsLastFetch=0;
}
