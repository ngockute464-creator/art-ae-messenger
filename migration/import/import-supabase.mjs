// ART-AE: one-time atomic import from the known Supabase project to local PostgreSQL.
// READ-ONLY source: GET /rest/v1/*. Never prints secrets or row contents.
// Destination MUST BE EMPTY. This script never deletes source records or touches Yandex Disk.
// Requires SUPABASE_URL and SUPABASE_SECRET_KEY in process environment.
import {transaction, assertLocalDatabase, closePool} from '../runtime/postgres.mjs';

const SOURCE_HOST='boaqwlhnpunfrfxbujxk.supabase.co';
const specs=[
  {name:'artae_users',cols:['id','name','role','key_hash','generation','disabled']},
  {name:'artae_projects',cols:['id','name','folder_path','avatar','created_by','created_at','updated_at','deleted_at']},
  {name:'artae_conversations',cols:['id','project_id','name','avatar','created_at','updated_at','deleted_at']},
  {name:'artae_messages',cols:['id','conversation_id','author_id','author_name','body','created_at','edited_at','deleted_at']},
  {name:'artae_pins',cols:['id','project_id','scope','scope_id','item_kind','item_key','note','created_at']},
  {name:'artae_office_locks',cols:['project_id','file_path','token','owner_user_id','owner_name','expires_at']},
  {name:'artae_sessions',cols:['sid','user_id','generation','last_seen','created_at']}
];
const names=specs.map(s=>s.name);
let outcome='IMPORT_NOT_STARTED';

function sourceSettings(){
  const raw=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!raw||!key||typeof raw!=='string'||typeof key!=='string')throw Error('Missing Supabase read credentials');
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.hostname!==SOURCE_HOST||u.pathname!=='/'||u.search||u.hash||u.port)
    throw Error('Unexpected Supabase source. Refusing migration.');
  return {base:u.origin,key};
}

async function fetchAll(spec,source){
  const results=[];
  const pageSize=500;
  for(let offset=0;offset<=50000;offset+=pageSize){
    const url=new URL(source.base+'/rest/v1/'+spec.name);
    url.searchParams.set('select',spec.cols.join(','));
    url.searchParams.set('order',spec.name==='artae_sessions'?'sid.asc':spec.name==='artae_office_locks'?'project_id.asc,file_path.asc':'id.asc');
    url.searchParams.set('limit',String(pageSize));
    url.searchParams.set('offset',String(offset));
    const response=await fetch(url,{method:'GET',headers:{
      apikey:source.key,Accept:'application/json'
    },signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Source '+spec.name+' fetch failed, status '+response.status);
    const batch=await response.json();
    if(!Array.isArray(batch))throw Error('Invalid source data: '+spec.name);
    results.push(...batch);
    if(batch.length<pageSize)return results;
  }
  throw Error('Source pagination safety limit: '+spec.name);
}

async function main(){
  await assertLocalDatabase();
  const source=sourceSettings();
  const snapshot=new Map();
  for(const spec of specs){
    const rows=await fetchAll(spec,source);
    snapshot.set(spec.name,rows);
    console.log('SOURCE_READ',spec.name,rows.length);
  }
  if(snapshot.get('artae_users').length===0||
     snapshot.get('artae_projects').length===0||
     snapshot.get('artae_conversations').length===0||
     snapshot.get('artae_messages').length===0)
    throw Error('Source unexpectedly empty. Refusing import.');

  const count=await transaction(async tx=>{
    // Exclusive lock ensures the target cannot change during the empty check/import.
    for(const name of names)await tx('LOCK TABLE public.'+name+' IN ACCESS EXCLUSIVE MODE');
    for(const name of names){
      const {rows:[r]}=await tx('SELECT count(*)::integer AS n FROM public.'+name);
      if(r.n!==0)throw Error('Target not empty: '+name+'. Refusing import.');
    }
    const totals={};
    for(const spec of specs){
      const rows=snapshot.get(spec.name);
      const cols=spec.cols;
      const placeholders=cols.map((_,i)=>'$'+(i+1)).join(',');
      const sql='INSERT INTO public.'+spec.name+' ('+cols.join(',')+') VALUES ('+placeholders+')';
      for(const row of rows){
        const args=cols.map(col=>col==='note'&&row[col]==null?'':row[col]??null);
        await tx(sql,args);
      }
      const {rows:[r]}=await tx('SELECT count(*)::integer AS n FROM public.'+spec.name);
      if(r.n!==rows.length)throw Error('Mismatch after insert: '+spec.name);
      totals[spec.name]=r.n;
    }
    return totals;
  });
  outcome='IMPORT_OK';
  console.log('ARTAE_IMPORT_OK',JSON.stringify(count));
}

try{
  await main();
}catch(err){
  console.error('ARTAE_IMPORT_FAILED',err.message);
  process.exitCode=1;
}finally{
  await closePool().catch(()=>{});
}
