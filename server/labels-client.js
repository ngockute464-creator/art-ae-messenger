// Shared labels with conservative migration from older browser-local preferences.
// Never erase browser labels until server confirms their import.
const legacyLabels=Array.isArray(data.labels)?data.labels.map(x=>({...x})):[];
let labelsProject=null,labelsBusy=false,labelsLastFetch=0,labelsActive=false;
const LABEL_IMPORT_KEY='artae_shared_label_import_v1_'+userId();
let labelImports={};
try{labelImports=JSON.parse(localStorage.getItem(LABEL_IMPORT_KEY)||'{}')||{}}catch{}
function labelOwner(kind,item){
 if(kind==='message'){
  const m=data.messages.find(m=>m.id===item);
  const pin=data.pins.find(p=>p.kind==='message'&&p.item===item&&p.convoId);
  const convoId=m?.convo||pin?.convoId;
  return data.convos.find(c=>c.id===convoId)?.project||null;
 }
 if(kind==='file'){
  if(data.files.some(f=>f.id===item)){
   const f=data.files.find(f=>f.id===item);
   const m=data.messages.find(m=>m.id===f?.message);
   return data.convos.find(c=>c.id===m?.convo)?.project||null;
  }
  // Project file paths are scoped by their pin or project explorer.
  if(data.pins.some(p=>p.kind==='file'&&p.item===item&&p.project===project))return project;
 }
 return null;
}
function labelImportCandidates(target){
 const groups=new Map();
 for(const l of legacyLabels){
  if(!l||!['message','file'].includes(l.kind)||typeof l.item!=='string'||typeof l.name!=='string')continue;
  const name=l.name.trim();
  if(!name||name.length>40||labelOwner(l.kind,l.item)!==target)continue;
  const key=l.kind+':'+l.item+':'+name;
  if(labelImports[target+'|'+key])continue;
  const group=l.kind+':'+l.item;
  if(!groups.has(group))groups.set(group,{kind:l.kind,item:l.item,names:[],keys:[]});
  const row=groups.get(group);
  if(!row.names.includes(name)&&row.names.length<12){row.names.push(name);row.keys.push(target+'|'+key)}
 }
 return [...groups.values()];
}
async function labelsRequest(action,payload={},get=false){
 const url='/.netlify/functions/labels';
 const response=await fetch(get?url+'?'+new URLSearchParams(payload):url,{
  credentials:'same-origin',cache:'no-store',
  ...(get?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})})
 });
 let result={};try{result=await response.json()}catch{}
 if(!response.ok)throw Error(result.error||'Не удалось синхронизировать метки');
 return result;
}
async function refreshSharedLabels(force=false){
 const target=project;
 if(!target||labelsBusy||!document.body)return;
 if(!force&&target===labelsProject&&Date.now()-labelsLastFetch<5000)return;
 labelsBusy=true;
 try{
  const candidates=labelImportCandidates(target);
  if(candidates.length){
   // Import is insert-only. A failed import never clears local labels.
   for(let i=0;i<candidates.length;i+=100){
    const batch=candidates.slice(i,i+100);
    await labelsRequest('merge',{project:target,labels:batch.map(({kind,item,names})=>({kind,item,names}))});
    for(const row of batch)for(const k of row.keys)labelImports[k]=true;
    localStorage.setItem(LABEL_IMPORT_KEY,JSON.stringify(labelImports));
   }
  }
  const reply=await labelsRequest('',{project:target},true);
  if(project!==target)return;
  const shared=(reply.labels||[]).map(l=>({...l,project:target}));
  data.labels=data.labels.filter(l=>l.project!==target&&(!labelOwner(l.kind,l.item)||labelOwner(l.kind,l.item)!==target)).concat(shared);
  labelsProject=target;labelsLastFetch=Date.now();labelsActive=true;
  if(!modal&&!editing&&document.activeElement?.id!=='draft')render();
 }catch(error){console.warn('Shared labels:',error.message)}
 finally{labelsBusy=false}
}
async function saveSharedLabels(kind,item,text){
 const target=labelOwner(kind,item)||project;
 if(!target)throw Error('Проект метки не определён');
 const names=[...new Set(String(text).split(',').map(n=>n.trim()).filter(Boolean))].slice(0,12);
 if(names.some(n=>n.length>40))throw Error('Метка длиннее 40 символов');
 await labelsRequest('set',{project:target,kind,item,names});
 data.labels=data.labels.filter(l=>!(l.kind===kind&&l.item===item));
 for(const name of names)data.labels.push({kind,item,name,project:target});
 labelsProject=target;labelsLastFetch=0;
 // A later refresh must not replay this device's older labels over a new edit.
 for(const l of legacyLabels)if(l.kind===kind&&l.item===item){
  labelImports[target+'|'+kind+':'+item+':'+l.name.trim()]=true;
 }
 try{localStorage.setItem(LABEL_IMPORT_KEY,JSON.stringify(labelImports))}catch{}
}
