// Exercise an isolated copy of the real regression tests against the old atan
// predicate. The live geometry file is never replaced, even on test failure.
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url), token=randomUUID();
const geometryUrl=new URL('solar-system/src/surface/.eclipse-mutation-'+token+'.js',root);
const testUrl=new URL('solar-system/tests/.eclipse-mutation-'+token+'.test.js',root);
const original=await readFile(new URL('solar-system/src/surface/geometry.js',root),'utf8');
const fixed='angularDiameter(target.radiusKm, target.distanceKm) / 2';
assert.equal(original.split(fixed).length,2,'expected one predicate radius expression');
const mutated=original.replace(fixed,'Math.atan(target.radiusKm / target.distanceKm)');
const regression=await readFile(new URL('solar-system/tests/surface-eclipse.test.js',root),'utf8');
const created=[];
try {
  await writeFile(geometryUrl,mutated,{flag:'wx'});created.push(geometryUrl);
  await writeFile(testUrl,regression.replace('../src/surface/geometry.js','../src/surface/.eclipse-mutation-'+token+'.js'),{flag:'wx'});created.push(testUrl);
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('node_modules/tsx/dist/cli.mjs',root)),
    '--test','--test-reporter=tap',fileURLToPath(testUrl)],{cwd:fileURLToPath(root),encoding:'utf8'});
  if(result.error)throw result.error;
  const output=result.stdout+result.stderr;
  await mkdir(new URL('test-results/',root),{recursive:true});
  await writeFile(new URL('test-results/phobos-eclipse-mutation.log',root),output);
  assert.equal(result.status,1,'old atan must fail the regression suite');
  assert.match(output,/# tests 3/);
  assert.match(output,/# fail 3/);
  assert.match(output,/decision boundary/);
  assert.match(output,/00:39 has not fully cleared Mars/);
  const report={mutation:'Only sunHiddenByParent: angularDiameter(r,d)/2 -> atan(r/d)',
    exitCode:result.status,tests:3,failed:3,liveGeometryUnchanged:true,
    limitation:'New safe default moments also pass the narrower old predicate; the independent boundary and rejected moment tests detect the bug.'};
  assert.equal(await readFile(new URL('solar-system/src/surface/geometry.js',root),'utf8'),original);
  await writeFile(new URL('test-results/phobos-eclipse-mutation.json',root),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  for(const file of created)await unlink(file);
}
