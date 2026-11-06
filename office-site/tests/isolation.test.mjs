import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const client=readFileSync('office-site/integration/office-client.js','utf8');
const frame=readFileSync('office-site/integration/office-frame.js','utf8');
const build=readFileSync('office-site/build.mjs','utf8');
test('isolation: different origin required',()=>{
 assert.match(client,/u\.origin===location\.origin/);
 assert.match(client,/event\.origin!==officeOrigin/);
 assert.match(client,/event\.source!==frame\.contentWindow/);
 assert.match(client,/frame\.src=requireOfficeOrigin\(\)/);
 assert.match(frame,/event\.origin!==origin\|\|event\.source!==window\.parent/);
});
test('Office site has fixed parent, no session secrets',()=>{
 assert.match(build,/ARTAE_PARENT_ORIGIN/);
 assert.match(build,/frame-ancestors/);
 assert.match(build,/2ee1000584945e69ee872cbd21ab2f8bd7a80d8d/);
 assert.doesNotMatch(build,/YANDEX_DISK_TOKEN|SUPABASE_SECRET_KEY/);
});
