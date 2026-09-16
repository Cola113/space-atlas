// The release gate for what the visitor actually sees.
//
// The browser checks already existed one at a time, run by hand. This runs them as a single command
// against the built app, so CI and a local run do the same thing, and so "the screenshots were
// written" is never the evidence: every check must exit 0 *and* leave a numeric report that parses
// and contains no failure. Failure screenshots and reports are kept for upload.
//
//   npm run test:visual                       every check
//   npm run test:visual -- --only=landings    one or more ids, comma separated
//   npm run test:visual -- --no-build         reuse the dist/ that is already there
//
// The app is served by the project's own production server (server/index.js) on a free port, not by
// the dev server, so the gate measures the artefact that would ship.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launchBrowser,browserChannel} from './browser-launch.mjs';

const CHECKS=[
  {id:'integration',script:'verify-integration.mjs',reports:['test-results/integration.json'],
   what:'key screenshots, scene switching and asset loading'},
  {id:'saturn-shadows',script:'verify-saturn-shadows.mjs',reports:['test-results/saturn-shadows/report.json'],
   what:'Saturn ring-shadow toggle and four viewports'},
  {id:'controls',script:'verify-solar-controls.mjs',reports:['test-results/solar-controls/report.json'],
   what:'phone, tablet and short-landscape layout, hit targets, safe area'},
  {id:'sky-bodies',script:'verify-sky-bodies.mjs',reports:['test-results/sky-bodies/report.json'],
   what:'ring and sky pixel levels in the landing view'},
  {id:'landings',script:'verify-landings.mjs',reports:['test-results/landings/report.json'],
   what:'every landing site across four viewports, canvas pixels'},
];

const args=process.argv.slice(2);
const only=(args.find(a=>a.startsWith('--only='))||'').slice(7).split(',').filter(Boolean);
const skipBuild=args.includes('--no-build');
const root=fileURLToPath(new URL('../',import.meta.url));
const selected=only.length?CHECKS.filter(c=>only.includes(c.id)):CHECKS;
const unknown=only.filter(id=>!CHECKS.some(c=>c.id===id));
if(unknown.length){console.error(`unknown check id(s): ${unknown.join(', ')}; known: ${CHECKS.map(c=>c.id).join(', ')}`);process.exit(2);}

const run=(command,argv,options={})=>new Promise(resolve=>{
  // npm and npx are .cmd shims on Windows; without a shell they are not executable.
  const child=spawn(command,argv,{cwd:root,env:{...process.env,...options.env},stdio:['ignore','pipe','pipe'],
    shell:process.platform==='win32'});
  let out='';
  child.stdout.on('data',d=>{out+=d;if(options.echo)process.stdout.write(d);});
  child.stderr.on('data',d=>{out+=d;if(options.echo)process.stderr.write(d);});
  child.on('close',code=>resolve({code,out}));
});

const freePort=()=>new Promise(resolve=>{
  const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});
});

// A report counts only if it parses and says nothing failed. Absence is a failure, which is the
// point: a check that dies before writing its numbers must not pass by having written screenshots.
const readReport=async path=>{
  try{return JSON.parse(await readFile(fileURLToPath(new URL(`../${path}`,import.meta.url)),'utf8'));}
  catch(error){return {__unreadable:String(error.message||error)};}
};
const failures=json=>{
  const found=[];
  const walk=node=>{
    if(Array.isArray(node))return node.forEach(walk);
    if(node&&typeof node==='object'){
      for(const [key,value] of Object.entries(node)){
        if(key==='passed'&&value===false)found.push(node.id||node.name||node.viewport||'unnamed entry');
        walk(value);
      }
    }
  };
  walk(json);return found;
};

if(!skipBuild){
  console.log('building the app under test (npm run build)');
  const build=await run('npm',['run','build']);
  if(build.code!==0){console.error(build.out.slice(-3000));console.error('build failed, nothing to verify');process.exit(1);}
}

const port=await freePort();
const server=spawn(process.execPath,['server/index.js'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
const base=`http://127.0.0.1:${port}`;
const stopServer=()=>{try{server.kill();}catch{}};
process.on('exit',stopServer);

const waitForServer=async()=>{
  for(let attempt=0;attempt<60;attempt++){
    try{
      const response=await fetch(`${base}/solar-system/`);
      if(response.ok)return true;
    }catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  return false;
};
if(!await waitForServer()){stopServer();console.error(`the production server never answered on ${base}`);process.exit(1);}
console.log(`serving dist/ on ${base}; browser channel: ${browserChannel}`);

// Fail before spending minutes on the checks if the chosen browser cannot start at all.
try{const probe=await launchBrowser();await probe.close();}
catch(error){stopServer();console.error(`cannot launch the browser (channel ${browserChannel}): ${error.message}`);process.exit(1);}

await mkdir(new URL('../test-results/visual/',import.meta.url),{recursive:true});
const results=[];
for(const check of selected){
  const started=Date.now();
  console.log(`\n=== ${check.id}: ${check.what}`);
  const {code,out}=await run('npx',['tsx',`scripts/${check.script}`],{env:{ATLAS_URL:base},echo:true});
  const reports=[];
  for(const path of check.reports){
    const json=await readReport(path);
    reports.push({path,readable:!json.__unreadable,unreadable:json.__unreadable,
      failures:json.__unreadable?[]:failures(json)});
  }
  const bad=reports.filter(r=>!r.readable||r.failures.length);
  const passed=code===0&&reports.length>0&&bad.length===0;
  results.push({id:check.id,what:check.what,exitCode:code,seconds:Math.round((Date.now()-started)/1000),passed,reports});
  const detail=passed?'':` (exit ${code}${bad.length?'; '+bad.map(r=>`${r.path}: ${r.unreadable||r.failures.join(', ')}`).join('; '):''})`;
  console.log(`${check.id}: ${passed?'passed':'FAILED'} in ${results.at(-1).seconds}s${detail}`);
}

stopServer();
const summary={base,browserChannel,built:!skipBuild,passed:results.every(r=>r.passed),checks:results};
await writeFile(new URL('../test-results/visual/report.json',import.meta.url),JSON.stringify(summary,null,2));
console.log(`\n${results.filter(r=>r.passed).length}/${results.length} visual checks passed`);
for(const r of results)console.log(`  ${r.passed?'pass':'FAIL'}  ${r.id.padEnd(16)} ${String(r.seconds).padStart(4)}s  ${r.what}`);
console.log('report: test-results/visual/report.json');
process.exit(summary.passed?0:1);
