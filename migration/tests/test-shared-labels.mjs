// Shared labels API behavior and safe migration assertions.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const api=readFileSync('migration/runtime/labels.mjs','utf8');
const client=readFileSync('server/labels-client.js','utf8');
const patch=readFileSync('server/files-patch.mjs','utf8');
const ux=readFileSync('server/ux-client.js','utf8');
const route=readFileSync('migration/runtime/http-server.mjs','utf8');
const sql=readFileSync('migration/sql/007_shared_labels.sql','utf8');
const script=readFileSync('migration/deploy/apply-shared-labels.sh','utf8');
assert.match(route,/\['labels',labels\]/,'Local server exposes authenticated labels');
assert.match(patch,/await saveSharedLabels\(m\.kind,m\.id,val\)/,'Edits persist to shared labels');
assert.match(patch,/labelsClient/,'Shared labels client included in build');
assert.match(ux,/refreshSharedLabels\(true\)/,'Labels refresh on project navigation');
assert.match(ux,/setInterval\(\(\)=>\{if\(project&&!document\.hidden\)/,'Other-device updates polled');
assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.artae_labels/);
assert.match(sql,/PRIMARY KEY\(project_id,item_kind,item_key,name\)/);
assert.match(sql,/ON CONFLICT\(version\) DO NOTHING/);
assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE public\.artae_messages/i);
assert.match(script,/pg_dump --format=custom/,'Pre-migration backup is mandatory');
assert.match(script,/EXPECTED_SHA/,'Migrate only pinned commit');
assert.doesNotMatch(client,/legacyLabels|LABEL_IMPORT_KEY|importLegacyMessages|labelImportCandidates|localStorage/,'Browser-local migration is removed');
assert.doesNotMatch(api,/importLegacy|action==='merge'/,'Legacy write API is retired');
assert.match(patch,/data.pins=\[\];data.labels=\[\]/,'Local label cache is no longer loaded from preferences');
assert.match(patch,/function labelList\(kind,item\)\{return data.labels.filter\(l=>l.kind===kind&&l.item===item&&l.project===project\)\}/,'Labels remain project scoped');

const project='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const message='33333333-3333-4333-8333-333333333333';
const user='44444444-4444-4444-8444-444444444444';
const rows=new Map();
const query=async (sql,params=[])=>{
 if(sql.includes('FROM public.artae_projects'))return {rows:params[0]===project?[{id:project}]:[]};
 if(sql.startsWith('SELECT c.project_id FROM public.artae_messages'))return {rows:params[0]===message?[{project_id:project}]:[]};
 if(sql.includes('FROM public.artae_messages m JOIN'))return {rows:params[0]===message&&params[1]===project?[{id:message}]:[]};
 if(sql.startsWith('SELECT item_kind AS kind,'))return {rows:[...rows.values()].filter(r=>r.project===params[0]).map(r=>({kind:r.kind,item:r.item,name:r.name}))};
 if(sql.startsWith('DELETE FROM public.artae_labels')){
  for(const [key,r]of rows)if(r.project===params[0]&&r.kind===params[1]&&r.item===params[2])rows.delete(key);
  return {rows:[]};
 }
 if(sql.startsWith('INSERT INTO public.artae_labels')){
  const [project,kind,item,name]=sql.includes("VALUES($1,'message'")?
   [params[0],'message',params[1],params[2]]:params;
  rows.set([project,kind,item,name].join('|'),{project,kind,item,name});return {rows:[]};
 }
 throw Error('Unexpected SQL '+sql);
};
const code=api.replace(/^import .*;$/gm,'').replace('export default async function handler','async function handler');
const handler=runInNewContext(code+'\nhandler',{
 getSession:async()=>({user:{id:user}}),query,transaction:async fn=>fn(query),
 Response,URL,console,Date,Error,Object,Array,Set
});
const call=async (action,extra={})=>{
 const req=new Request('https://artae.example/.netlify/functions/labels',{
  method:'POST',headers:{origin:'https://artae.example','content-type':'application/json'},
  body:JSON.stringify({action,project,...extra})
 });
 const response=await handler(req);return {status:response.status,body:await response.json()};
};
let r=await call('set',{kind:'message',item:message,names:['Срочно','Проверить','Срочно']});
assert.equal(r.status,200);
assert.equal(rows.size,2,'Duplicate labels are removed');
const get=await handler(new Request('https://artae.example/.netlify/functions/labels?project='+project));
assert.equal((await get.json()).labels.length,2);
r=await call('merge',{labels:[]});
assert.equal(r.status,404,'Retired merge endpoint is unavailable');
r=await call('importLegacy',{labels:[]});
assert.equal(r.status,404,'Retired legacy import endpoint is unavailable');
r=await call('set',{kind:'message',item:message,names:['Готово']});
assert.equal(r.status,200);
assert.equal(rows.size,1);
assert.equal([...rows.values()][0].name,'Готово');
r=await call('set',{kind:'message',item:other,names:['Ошибка']});
assert.equal(r.status,404,'Foreign or missing message cannot be labeled');
r=await call('set',{kind:'file',item:'../private',names:['Ошибка']});
assert.equal(r.status,400,'Traversal rejected');
r=await call('set',{kind:'message',item:message,names:['x'.repeat(41)]});
assert.equal(r.status,400,'Overlong name rejected');
r=await call('set',{kind:'message',item:message,names:[]});
assert.equal(r.status,200);
assert.equal(rows.size,0,'Empty set removes labels');
console.log('SHARED_LABELS_OK project_isolation=true duplicate_merge=true atomic_set=true validations=true legacy_import_removed=true');
