// Private Supabase Realtime transport. Chat data is fetched only from ART-AE API.
let rtSocket=null,rtConvo=null,rtConnected=false,rtGeneration=0,rtHeartbeat=null,rtRefresh=null,rtRetryTimer=null,rtLastFallback=0;
let rtSeq=0,rtRetry=0,rtDisabled=false;
function rtPush(socket,topic,event,payload,joinRef){
 if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({topic,event,payload,ref:String(++rtSeq),join_ref:joinRef||null}));
}
function stopRealtime(){
 rtGeneration++;rtConnected=false;rtConvo=null;
 clearInterval(rtHeartbeat);clearTimeout(rtRefresh);clearTimeout(rtRetryTimer);
 rtHeartbeat=null;rtRefresh=null;rtRetryTimer=null;
 if(rtSocket){const socket=rtSocket;rtSocket=null;socket.onclose=null;socket.onerror=null;socket.onmessage=null;try{socket.close()}catch{}}
}
function scheduleRealtimeRetry(id){
 if(document.hidden||id!==convo||view!=='chat')return;
 clearTimeout(rtRetryTimer);
 const delay=Math.min(30000,2000*Math.pow(2,Math.min(rtRetry++,4)));
 rtRetryTimer=setTimeout(()=>{if(id===convo&&!document.hidden&&view==='chat')connectRealtime(id)},delay);
}
async function connectRealtime(id){
 if(!id||rtDisabled||document.hidden||view!=='chat')return;
 stopRealtime();rtConvo=id;
 const generation=rtGeneration;
 try{
  const response=await fetch('/.netlify/functions/realtime-token?'+new URLSearchParams({convo:id}),{credentials:'same-origin',cache:'no-store'});
  if(response.status===503){rtDisabled=true;throw Error('Realtime not configured yet')}
  if(!response.ok)throw Error('Realtime token unavailable: '+response.status);
  const settings=await response.json();
  if(generation!==rtGeneration||id!==convo||document.hidden||view!=='chat')return;
  const endpoint=new URL(settings.url);
  if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.supabase.co'))throw Error('Unexpected Realtime endpoint');
  endpoint.protocol='wss:';endpoint.pathname='/realtime/v1/websocket';endpoint.search=new URLSearchParams({apikey:settings.publishableKey,vsn:'1.0.0'}).toString();
  const socket=new WebSocket(endpoint.toString()),topic='realtime:'+settings.topic;
  rtSocket=socket;
  const joinRef=String(++rtSeq);
  socket.onopen=()=>{
   if(generation!==rtGeneration)return;
   rtPush(socket,topic,'phx_join',{config:{private:true,broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:[]},access_token:settings.token},joinRef);
   rtHeartbeat=setInterval(()=>rtPush(socket,'phoenix','heartbeat',{}),20000);
  };
  socket.onmessage=e=>{
   if(generation!==rtGeneration)return;
   let message;try{message=JSON.parse(e.data)}catch{return}
   if(message.event==='phx_reply'&&message.ref===joinRef){
    if(message.payload?.status==='ok'){
     rtConnected=true;rtRetry=0;syncMessages(true);
     const refreshIn=Math.max(30000,(settings.expiresAt*1000-Date.now())-120000);
     rtRefresh=setTimeout(async()=>{
      if(generation!==rtGeneration||socket.readyState!==WebSocket.OPEN)return;
      try{
       const updated=await fetch('/.netlify/functions/realtime-token?'+new URLSearchParams({convo:id}),{credentials:'same-origin',cache:'no-store'});
       if(!updated.ok)throw Error('Token refresh failed');
       const auth=await updated.json();
       if(generation===rtGeneration)rtPush(socket,topic,'access_token',{access_token:auth.token},joinRef);
       if(generation===rtGeneration)setTimeout(()=>{if(generation===rtGeneration)connectRealtime(id)},7*60*1000);
      }catch{if(generation===rtGeneration){stopRealtime();scheduleRealtimeRetry(id)}}
     },refreshIn);
    }else{socket.close()}
   }
   if(message.event==='broadcast'&&message.topic===topic&&message.payload?.event==='changed'){
    syncMessages(true);
   }
  };
  socket.onclose=()=>{if(generation!==rtGeneration)return;rtConnected=false;clearInterval(rtHeartbeat);clearTimeout(rtRefresh);scheduleRealtimeRetry(id)};
  socket.onerror=()=>{if(generation===rtGeneration)rtConnected=false};
 }catch(e){if(generation!==rtGeneration)return;rtConnected=false;console.info('Realtime fallback:',e.message);if(!rtDisabled)scheduleRealtimeRetry(id)}
}
