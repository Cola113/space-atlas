import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { deploymentFetch } from './deployment-access.mjs';

const base = process.env.ATLAS_URL;
assert.ok(base && new URL(base).protocol === 'https:', 'Set ATLAS_URL to the deployed HTTPS origin');
const output = new URL(process.env.ATLAS_OUTPUT || '../test-results/release/http/', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = new Set(['release.json', 'ephemeris/manifest.json', 'solar-system/physical-definitions.json']);
const docs = ['REALISM_STANDARD.md', 'TODO.md', 'PERFORMANCE_VALIDATION.md', 'RELEASE_ACCEPTANCE.md',
  'solar-system/BODY_MODELS.md', 'solar-system/GROUND_AUDIT.md', 'surface/README.md'];
const links = [];
await mkdir(output, {recursive:true});
for (const path of await readdir(new URL('assets/', dist))) paths.add(`assets/${path}`);
for (const system of ['saturn','uranus','pluto']) {
  for (let year=1900;year<=2100;year++) paths.add(`ephemeris/${system}/${year}.bin`);
}
for (const doc of docs) {
  paths.add(doc);
  const source = await readFile(new URL(doc,dist),'utf8');
  for (const match of source.matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(match[1])) continue;
    const target = new URL(match[1],new URL(doc,`${base}/`));
    assert.equal(target.origin, new URL(base).origin);
    const path = decodeURIComponent(target.pathname.slice(1));
    // Missing published files fail before any network work.
    await readFile(new URL(path,dist));
    links.push({from:doc,to:path}); paths.add(path);
  }
}
const previews = JSON.parse(await readFile(new URL('solar-system/textures/previews/manifest.json',dist),'utf8'));
paths.add('solar-system/textures/previews/manifest.json');
for (const item of previews.firstScreen) paths.add(`solar-system/textures/${item.file}`);
const panoramas = JSON.parse(await readFile(new URL('../test-results/surface-panorama/assets.json',import.meta.url),'utf8'));
for (const {file} of panoramas) paths.add(file.replace(/^\//,''));
const report = {base,startedAt:new Date().toISOString(),links,files:[],routes:[],errors:[]};
try {
  const pending = [...paths];
  let cursor=0;
  const workers = await Promise.allSettled(Array.from({length:8},async()=>{
    while(cursor<pending.length) {
      const path=pending[cursor++];
      const response=await deploymentFetch(new URL(path,`${base}/`),{signal:AbortSignal.timeout(60000)});
      assert.equal(response.status,200,`${path}: ${response.status}`);
      const actual=Buffer.from(await response.arrayBuffer()), expected=await readFile(new URL(path,dist));
      assert.equal(sha(actual),sha(expected),`${path}: deployed bytes differ from tested dist`);
      report.files.push({path,status:response.status,bytes:actual.length,sha256:sha(actual)});
      if(report.files.length%100===0) console.log(`Verified ${report.files.length}/${pending.length} deployed files`);
    }
  }));
  for (const result of workers) if(result.status==='rejected') report.errors.push(String(result.reason));
  assert.equal(report.errors.length,0,report.errors.join('\n'));
  for (const [path,expectedPath] of [['/','/solar-system/'],['/solar-system','/solar-system/'],['/black-hole','/black-hole/'],['/orion-nebula','/orion-nebula/']]) {
    const response=await deploymentFetch(`${base}${path}`,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);
    assert.equal(new URL(response.url).pathname,expectedPath);
    const html=await response.text();
    assert.match(html,/type="module"/);
    assert.match(html,/assets\//);
    report.routes.push({path,status:response.status,final:response.url});
  }
  const absent=await deploymentFetch(`${base}/api/clouds/does-not-exist`,{signal:AbortSignal.timeout(30000)});
  assert.equal(absent.status,404);
  assert.match(absent.headers.get('content-type'),/application\/json/);
  assert.match((await absent.json()).error,/未找到云图接口/);
  report.apiRouting={status:404,structuredError:true};
  report.finishedAt=new Date().toISOString();
  report.passed=true;
  console.log(JSON.stringify({base,verifiedFiles:report.files.length,ephemerisYears:report.files.filter(f=>f.path.endsWith('.bin')).length,linkedDocuments:links.length,routes:report.routes.length,passed:true}));
} catch(error) {
  report.passed=false;report.errors.push(String(error));throw error;
} finally {
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));
}
