import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
const runs=[];
try {
 for(let i=0;i<3;i++) {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:1024*1024,uploadThroughput:512*1024});
  await page.goto((process.env.ATLAS_URL||'http://127.0.0.1:5174')+'/solar-system/',{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>document.documentElement.dataset.sceneReady==='true'&&document.getElementById('loading-screen').hidden,null,{timeout:180000});
  const result=await page.evaluate(()=>({ms:performance.now(),resources:performance.getEntriesByType('resource').map(r=>({name:r.name.split(location.origin)[1],bytes:r.transferSize,duration:r.duration})),snapshot:window.solarAtlas.snapshot()}));
  runs.push(result);console.log(JSON.stringify({run:i,ms:result.ms}));await context.close();
 }
 await mkdir('test-results/performance',{recursive:true});
 await writeFile(`test-results/performance/${process.env.ATLAS_BENCHMARK||'startup'}.json`,JSON.stringify({medianMs:runs.map(r=>r.ms).sort((a,b)=>a-b)[1],runs},null,2));
}finally {await browser.close();}
