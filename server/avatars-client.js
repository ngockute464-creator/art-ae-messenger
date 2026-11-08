// Shared profile photos are user-scoped, never stored on chat messages.
const sharedAvatars=new Map();
let avatarsLoading=false,avatarsLastFetch=0;
const AVATAR_ADOPTED_KEY='artae_shared_avatar_adopted_v1_'+userId();
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
 let data={};try{data=await response.json()}catch{}
 if(!response.ok)throw Error(data.error||'Не удалось сохранить аватар');
 return data;
}
async function saveOwnAvatar(avatar){
 if(avatar!==null&&!avatarSafe(avatar))throw Error('Фотография слишком велика или имеет неверный формат');
 const result=await avatarsRequest('set',avatar);
 sharedAvatars.set(userId(),result.avatar||null);
 try{localStorage.setItem(AVATAR_ADOPTED_KEY,'1')}catch{}
}
async function refreshSharedAvatars(force=false){
 if(avatarsLoading||document.hidden)return;
 if(!force&&Date.now()-avatarsLastFetch<25000)return;
 avatarsLoading=true;
 try{
  const response=await fetch('/.netlify/functions/avatars',{
   credentials:'same-origin',cache:'no-store'
  });
  let result={};try{result=await response.json()}catch{}
  if(!response.ok||!Array.isArray(result.avatars))throw Error(result.error||'Не удалось получить аватары');
  sharedAvatars.clear();
  for(const entry of result.avatars){
   if(typeof entry.id==='string')sharedAvatars.set(entry.id,avatarSafe(entry.avatar)?entry.avatar:null);
  }
  let mine=sharedAvatars.get(userId())||null;
  if(mine){
   try{localStorage.setItem(AVATAR_ADOPTED_KEY,'1')}catch{}
  }else if(avatarSafe(data.profile.avatar)&&localStorage.getItem(AVATAR_ADOPTED_KEY)!=='1'){
   // Migrate an existing personal photo only when no shared photo exists.
   // The server's compare-and-set prevents overwriting another device.
   const adopted=await avatarsRequest('migrate',data.profile.avatar);
   mine=adopted.avatar||null;
   sharedAvatars.set(userId(),mine);
   try{localStorage.setItem(AVATAR_ADOPTED_KEY,'1')}catch{}
  }
  // On later devices prefer the shared photo, including a deliberate removal.
  if(localStorage.getItem(AVATAR_ADOPTED_KEY)==='1'&&data.profile.avatar!==mine){
   data.profile.avatar=mine;
   persist();
  }
  avatarsLastFetch=Date.now();
  if(!modal&&!editing&&document.activeElement?.id!=='draft')render();
 }catch(error){console.warn('Shared avatars:',error.message)}
 finally{avatarsLoading=false}
}
setInterval(()=>{if(!document.hidden)void refreshSharedAvatars()},30000);
queueMicrotask(()=>void refreshSharedAvatars(true));
