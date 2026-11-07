// ART-AE M2 isolated HTTP server for local PostgreSQL.
// Bind to loopback: never change Caddy, production port 3100, or live services.
// Explicitly serves only auth and sync while other endpoints are being migrated.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import auth from './auth.mjs';
import sync from './sync.mjs';
import pins from './pins.mjs';
import filesExplorer from './files-explorer.mjs';
import voice from './voice.mjs';
import voiceTranscript from './voice-transcript.mjs';
import push from './push.mjs';
import {startPushWorker,stopPushWorker} from './push-worker.mjs';
import {startChatAttachmentCleanup,stopChatAttachmentCleanup} from './chat-attachment-cleanup.mjs';
import {assertLocalDatabase, query, closePool} from './postgres.mjs';

const HOST='127.0.0.1';
const PORT=Number(process.env.ARTAE_API_PORT||3101);
const ORIGIN=process.env.ARTAE_PUBLIC_ORIGIN||'http://127.0.0.1:3101';
if(!Number.isSafeInteger(PORT)||PORT<1024||PORT>65535)throw Error('Invalid API port');
if(!/^https?:\/\/[^/]+$/.test(ORIGIN))throw Error('Invalid configured origin');
const MAX_BODY=4*1024*1024;
const PREFIX='/.netlify/functions/';
const realtimeDisabled=()=>Response.json({enabled:false,error:'Local Realtime not yet enabled'},{status:503,headers:noCache});
const handlers=new Map([
  ['auth',auth],['sync',sync],['pins',pins],
  ['files-explorer',filesExplorer],['voice',voice],['voice-transcript',voiceTranscript],
  ['realtime-token',realtimeDisabled],['push',push]
]);
const noCache={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};

function fail(res,status,message) {
  if(res.headersSent||res.destroyed)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...noCache});
  res.end(JSON.stringify({error:message}));
}

const server=createServer(async(req,res)=>{
  try {
    const raw=req.url||'/';
    if(!raw.startsWith('/')||raw.startsWith('//'))return fail(res,400,'Invalid URL');
    const url=new URL(raw,ORIGIN);
    if(url.origin!==ORIGIN)return fail(res,400,'Invalid origin');
    if(url.pathname==='/healthz'&&req.method==='GET') {
      await query('SELECT 1');
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',...noCache});
      return res.end(JSON.stringify({ok:true}));
    }
    if(!url.pathname.startsWith(PREFIX))return fail(res,404,'Not found');
    const handler=handlers.get(url.pathname.slice(PREFIX.length));
    if(!handler)return fail(res,404,'Not found');
    const method=req.method||'GET';
    const declared=req.headers['content-length'];
    if(declared!==undefined){
      const length=Number(declared);
      if(!Number.isSafeInteger(length)||length<0||length>MAX_BODY)return fail(res,413,'Request too large');
    }
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers)){
      if(value===undefined||['host','connection','transfer-encoding','content-length'].includes(key))continue;
      headers.set(key,Array.isArray(value)?value.join(', '):value);
    }
    let body;
    if(method!=='GET'&&method!=='HEAD'){
      let size=0;
      body=Readable.toWeb(req).pipeThrough(new TransformStream({
        transform(chunk,controller){
          size+=chunk.byteLength;
          if(size>MAX_BODY)throw Error('Request too large');
          controller.enqueue(chunk);
        }
      }));
    }
    const request=new Request(url,{method,headers,...(body?{body,duplex:'half'}:{})});
    const response=await handler(request);
    if(!(response instanceof Response))throw Error('Invalid API response');
    const out={};
    // Preserve precise byte counts only on the authenticated media route.
    const isChatMedia=url.pathname===PREFIX+'files-explorer'&&
      ['chatMedia','projectMedia'].includes(url.searchParams.get('action'));
    for(const [key,value] of response.headers){
      if(['connection','transfer-encoding','set-cookie'].includes(key))continue;
      if(key==='content-length'&&!isChatMedia)continue;
      out[key]=value;
    }
    const cookies=response.headers.getSetCookie();
    if(cookies.length)out['Set-Cookie']=cookies;
    res.writeHead(response.status,out);
    if(!response.body||method==='HEAD')return res.end();
    await new Promise((resolve,reject)=>{
      Readable.fromWeb(response.body).on('error',reject).pipe(res).on('finish',resolve).on('error',reject);
    });
  } catch(error) {
    console.error('ARTAE-NEXT HTTP:',error?.message||error);
    if(!res.headersSent)fail(res,error?.message==='Request too large'?413:500,'Request failed');
    else res.destroy();
  }
});

try {
  await assertLocalDatabase();
  server.listen(PORT,HOST,()=>{console.log('ARTAE_NEXT_LISTENING '+HOST+':'+PORT);startPushWorker();startChatAttachmentCleanup()});
} catch(error) {
  console.error('ARTAE_NEXT_START_FAILED',error?.message||error);
  process.exitCode=1;
  await closePool();
}
server.on('error',err=>{console.error('ARTAE_NEXT_SERVER_ERROR',err.message);process.exitCode=1;});
async function shutdown(){
  stopPushWorker();
  stopChatAttachmentCleanup();
  server.close();
  await closePool().catch(()=>{});
}
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
