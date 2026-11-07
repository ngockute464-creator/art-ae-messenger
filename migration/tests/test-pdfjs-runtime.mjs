// Exercise the actual pinned PDF.js engine against a minimal syntactically
// valid PDF. This is not merely a text/asset presence check.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=(path)=>createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(digest('public/vendor/pdfjs/pdf.mjs'),
 '2792b7c390ad6d5f4245d326b70deebbc990fa4bcac691412f6df886abb9e867');
assert.equal(digest('public/vendor/pdfjs/pdf.worker.mjs'),
 '8336aabf764cb08c818555a2fd2545e4fed10837146de927564875c93b3c4f83');
assert.equal(digest('public/vendor/pdfjs/LICENSE'),
 '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594');
const pdfjs=await import('../../public/vendor/pdfjs/pdf.mjs');
assert.equal(pdfjs.version,'6.5.438');
pdfjs.GlobalWorkerOptions.workerSrc=new URL('../../public/vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
let pdf='%PDF-1.4\n',offsets=[0];
function obj(id,body){
 offsets[id]=Buffer.byteLength(pdf);
 pdf+=id+' 0 obj\n'+body+'\nendobj\n';
}
obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Contents 4 0 R >>');
obj(4,'<< /Length 0 >>\nstream\n\nendstream');
const xref=Buffer.byteLength(pdf);
pdf+='xref\n0 5\n0000000000 65535 f \n';
for(let i=1;i<=4;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
pdf+='trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n'+xref+'\n%%EOF\n';
const task=pdfjs.getDocument({
 data:new Uint8Array(Buffer.from(pdf,'utf8')),
 isEvalSupported:false,
 disableFontFace:true
});
const doc=await task.promise;
assert.equal(doc.numPages,1);
const page=await doc.getPage(1);
const vp=page.getViewport({scale:1});
assert.equal(vp.width,400);
assert.equal(vp.height,600);
const t=await page.getTextContent();
assert.ok(Array.isArray(t.items));
await task.destroy();
console.log('PDFJS_RUNTIME_OK pinned_assets=true page_count=1 dimensions=400x600 local_worker=true');
