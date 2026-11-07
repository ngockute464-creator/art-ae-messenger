// Vendor exact PDF.js legacy build locally at release assembly time.
// The browser never loads PDF.js from a CDN. Fail closed on download errors.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const VERSION='6.5.438';
const OUT='public/vendor/pdfjs';
const ASSETS=[
 {name:'pdf.mjs',min:350000,max:4000000,expectedSha256:'2792b7c390ad6d5f4245d326b70deebbc990fa4bcac691412f6df886abb9e867'},
 {name:'pdf.worker.mjs',min:600000,max:7000000,expectedSha256:'8336aabf764cb08c818555a2fd2545e4fed10837146de927564875c93b3c4f83'},
 {name:'LICENSE',min:8000,max:18000,expectedSha256:null}
];
const providers=[
 name=>'https://cdn.jsdelivr.net/npm/pdfjs-dist@'+VERSION+(name==='LICENSE'?'/LICENSE':'/legacy/build/'+name),
 name=>'https://unpkg.com/pdfjs-dist@'+VERSION+(name==='LICENSE'?'/LICENSE':'/legacy/build/'+name)
];
function verify(bytes,asset){
 if(bytes.length<asset.min||bytes.length>asset.max)return false;
 const text=bytes.toString('utf8');
 if(asset.name==='LICENSE'){
  if(!text.includes('Apache License')||!text.includes('Version 2.0'))return false;
 }else if(!text.includes(VERSION)||!text.includes('pdfjsVersion'))return false;
 const sha=createHash('sha256').update(bytes).digest('hex');
 if(asset.expectedSha256&&sha!==asset.expectedSha256)return false;
 console.log('PDFJS_VENDOR_VERIFIED '+asset.name+' version='+VERSION+' sha256='+sha+' bytes='+bytes.length);
 return true;
}
async function retrieve(asset){
 const target=OUT+'/'+asset.name;
 try{if(verify(readFileSync(target),asset))return}catch{}
 let last;
 for(const urlOf of providers){
  try{
   const url=urlOf(asset.name);
   const response=await fetch(url,{signal:AbortSignal.timeout(50000),redirect:'follow'});
   if(!response.ok||!response.url.startsWith('https://'))throw Error('HTTP '+response.status);
   if(Number(response.headers.get('content-length')||0)>asset.max)throw Error('Asset too large');
   const bytes=Buffer.from(await response.arrayBuffer());
   if(!verify(bytes,asset))throw Error('Unexpected PDF.js asset/version/hash');
   writeFileSync(target,bytes);
   return;
  }catch(err){last=err}
 }
 throw Error('Cannot vendor PDF.js '+asset.name+': '+(last?.message||'unknown error'));
}
mkdirSync(OUT,{recursive:true});
await Promise.all(ASSETS.map(retrieve));
