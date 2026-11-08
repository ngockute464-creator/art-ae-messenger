// Shared avatars: server is the only source of truth, including photo removal.
const sharedAvatars=new Map();
let avatarsLoading=false,avatarsLastFetch=0,avatarsEtag='';
const avatarSafe=value=>typeof value==='string'&&value.length<=80000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value);
function messageAuthorAvatar(m){
 const remote=sharedAvatars.get(m.authorId);
 return avatarSafe(remote)?remote:(isMine(m)&&avatarSafe(data.profile.avatar)?data.profile.avatar:null);
}
async function avatarsRequest(action,avatar){
 const response=await fetch('/.netlify/functions/avatars',{
  method:'POST',headers:{'Content-Type':'application/json'},
  credentials:'same-origin',cache:'no-store',body:JSON.stringify({action,avatar})
 });
 let result={};try{result=await response.json()}catch{}
 if(!response.ok)throw Error(result.error||'Не удалось сохранить аватар');
 return result;
}
async function saveOwnAvatar(avatar){
 if(avatar!==null&&!avatarSafe(avatar))throw Error('Фотография слишком велика или имеет неверный формат');
 const result=await avatarsRequest('set',avatar);
 sharedAvatars.set(userId(),result.avatar||null);
 avatarsEtag='';avatarsLastFetch=0;
}
async function refreshSharedAvatars(force=false){
 if(avatarsLoading||document.hidden)return;
 if(!force&&Date.now()-avatarsLastFetch<25000)return;
 avatarsLoading=true;
 try{
  const headers={};
  if(avatarsEtag)headers['If-None-Match']=avatarsEtag;
  const response=await fetch('/.netlify/functions/avatars',{
   headers,credentials:'same-origin',cache:'no-store'
  });
  if(response.status===304){avatarsLastFetch=Date.now();return}
  let result={};try{result=await response.json()}catch{}
  if(!response.ok||!Array.isArray(result.avatars))throw Error(result.error||'Не удалось получить аватары');
  const previous=JSON.stringify([...sharedAvatars]);
  sharedAvatars.clear();
  for(const entry of result.avatars){
   if(typeof entry.id==='string')sharedAvatars.set(entry.id,avatarSafe(entry.avatar)?entry.avatar:null);
  }
  avatarsEtag=response.headers.get('etag')||'';
  const mine=sharedAvatars.get(userId())||null;
  if(data.profile.avatar!==mine){data.profile.avatar=mine;persist()}
  avatarsLastFetch=Date.now();
  if(JSON.stringify([...sharedAvatars])!==previous&&!modal&&!editing&&document.activeElement?.id!=='draft')render();
 }catch(error){console.warn('Shared avatars:',error.message)}
 finally{avatarsLoading=false}
}
setInterval(()=>{if(!document.hidden)void refreshSharedAvatars()},30000);
queueMicrotask(()=>void refreshSharedAvatars(true));
