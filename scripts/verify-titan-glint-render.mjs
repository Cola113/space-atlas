import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';
const geometry=JSON.parse(await readFile('outputs/titan-glint-20260926/geometry.json','utf8'));
const base=process.env.ATLAS_URL || 'http://127.0.0.1:5192';
const browser=await launchBrowser(); const report=[];
await mkdir('test-results/titan-glint',{recursive:true});
try {
for(const [name,width,height] of [['desktop',1440,900],['phone',390,844],['short',800,450]]) {
  const pairs={};
  for(const epoch of ['on','off']) for(const enabled of [true,false]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    if(!enabled)await context.route('**/solar-system/src/titan-glint.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('radiance: 12','radiance: 0')});});
    await context.addInitScript(value=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value})),{selected:'titan',date:Date.parse(geometry[epoch].date),offset:geometry.on.cameraOffsetRadii.map(x=>x*.57),portrait:width<height,playing:false,followRotation:false,dynamics:false,orbits:false,labels:false,speed:1000,speedUnit:'realtime'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
    await page.goto(base+'/solar-system/');
    await page.waitForFunction(()=>window.solarAtlas?.snapshot().bodies?.find(b=>b.id==='titan')?.textureWidth===3840 && !window.solarAtlas.snapshot().flight,null,{timeout:90000});
    await page.waitForTimeout(900);
    await page.evaluate(g=>window.solarAtlas.titanGlintProbe(g.on.latitude,g.on.longitude,g.on.cameraOffsetRadii),geometry);
    await page.waitForTimeout(200);
    const snap=await page.evaluate(()=>window.solarAtlas.snapshot());const body=snap.bodies.find(b=>b.id==='titan');
    const png=await page.locator('canvas').first().screenshot();
    await writeFile('test-results/titan-glint/'+name+'-'+epoch+(enabled?'':'-baseline')+'.png',png);
    pairs[epoch+(enabled?'':'Base')]={body,...await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true})};
    assert.deepEqual(errors,[]); await context.close();
  }
  const stats={name,width,height};
  for(const epoch of ['on','off']) {
    const a=pairs[epoch],b=pairs[epoch+'Base'];let area=0,peak=0,sum=0,baseSum=0,xsum=0,ysum=0;let bounds=[width,height,0,0];
    assert.equal(a.data.length,b.data.length);
    for(let y=0;y<a.info.height;y++)for(let x=0;x<a.info.width;x++){
      if(Math.hypot(x-a.body.x,y-a.body.y)>a.body.radiusPx-1)continue;
      const i=(y*a.info.width+x)*3;
      const lum=.2126*a.data[i]+.7152*a.data[i+1]+.0722*a.data[i+2],baseline=.2126*b.data[i]+.7152*b.data[i+1]+.0722*b.data[i+2];
      const delta=lum-baseline;peak=Math.max(peak,delta);
      if(delta>20){area++;sum+=lum;baseSum+=baseline;xsum+=x;ysum+=y;bounds=[Math.min(bounds[0],x),Math.min(bounds[1],y),Math.max(bounds[2],x),Math.max(bounds[3],y)];}
    }
    stats[epoch]={date:geometry[epoch].date,area,peakDelta:peak,meanGlint:area?sum/area:0,meanSamePixelsWithoutGlint:area?baseSum/area:0,centroid:area?[xsum/area,ysum/area]:null,bounds:area?bounds:null,body:a.body};
    if(area){let surrounding=0,count=0;const cx=xsum/area,cy=ysum/area;for(let y=Math.floor(cy-14);y<=cy+14;y++)for(let x=Math.floor(cx-14);x<=cx+14;x++){const d=Math.hypot(x-cx,y-cy);if(d<8||d>14||x<0||y<0||x>=a.info.width||y>=a.info.height)continue;const i=(y*a.info.width+x)*3;surrounding+=.2126*a.data[i]+.7152*a.data[i+1]+.0722*a.data[i+2];count++;}stats[epoch].surroundingMean=surrounding/count;stats[epoch].relativeLuminance=(sum/area)/(surrounding/count);}
  }
  assert.ok(stats.on.area>=3,JSON.stringify(stats));assert.equal(stats.off.area,0,JSON.stringify(stats));
  report.push(stats);console.log(JSON.stringify(stats));
}
await writeFile('outputs/titan-glint-20260926/pixels.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
