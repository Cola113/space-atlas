import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { launchBrowser } from './browser-launch.mjs';
import { PhysicalState } from '../solar-system/src/physics/state.js';
import { EphemerisStore } from '../solar-system/src/physics/ephemeris.js';
import { localFetcher } from './verify-phobos-reference.mjs';
import { Vector3 } from 'three';
import sharp from 'sharp';
const base=process.env.ATLAS_URL||'http://127.0.0.1:5192';
const out='test-results/phobos-render';await mkdir(out,{recursive:true});
const browser=await launchBrowser(),report=[];
const provider=new PhysicalState({ephemeris:new EphemerisStore({fetcher:localFetcher})});
try {
  for(const [name,width,height,date] of [
    ['desktop-1900',1440,900,'1900-01-01T00:00:00Z'],
    ['desktop-2026',1440,900,'2026-09-26T00:00:00Z'],
    ['desktop-2100',1440,900,'2100-12-31T00:00:00Z'],
    ['phone',390,844,'2026-09-26T00:00:00Z'],['short',800,450,'2026-09-26T00:00:00Z']]) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    await context.addInitScript(date=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.parse(date),playing:false,selected:'phobos',speed:1000,speedUnit:'realtime'}})),date);
    const page=await context.newPage(),errors=[],years=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text());});
    page.on('response',r=>{if(r.url().includes('/ephemeris/phobos/'))years.push({url:r.url(),status:r.status()});});
    await page.goto(base+'/solar-system/',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked&&s.bodies.find(b=>b.id==='phobos')?.physicalAvailable;},null,{timeout:90000});
    await page.waitForFunction(()=>document.getElementById('loading-screen').hidden);
    await page.waitForFunction(()=>window.solarAtlas.snapshot().bodies.find(b=>b.id==='phobos').textureWidth>0,null,{timeout:60000});
    const s=await page.evaluate(()=>window.solarAtlas.snapshot()),b=s.bodies.find(b=>b.id==='phobos');
    await writeFile(out+'/'+name+'-snapshot.json',JSON.stringify(s,null,2));
    await page.screenshot({path:out+'/'+name+'-initial.png'});
    assert.equal(s.selected,'phobos');assert.equal(s.date,Date.parse(date));assert.equal(s.playing,false);
    assert.match(b.physicalModel,/MAR099/);assert.equal(b.visible,true);assert.ok(b.inView);assert.ok(b.textureWidth>0);
    assert.deepEqual(s.landing.filter(l=>l.body==='phobos').map(l=>l.siteId).sort(),['phobos-311e','phobos-60e']);
    assert.equal(s.landing.length,21);
    await provider.ensure(new Date(date),['phobos'],{prefetch:false});
    const expected=provider.frame(new Date(date)).bodies.get('phobos');
    const positionErrorKm=new Vector3().fromArray(b.physicalPositionKm).distanceTo(expected.positionKm);
    assert.ok(positionErrorKm<1e-7);assert.deepEqual(errors,[]);
    const canvas=await page.locator('canvas').first().screenshot();
    const {data}=await sharp(canvas).resize(96,64).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const activePixels=Array.from(data).filter(v=>v>25).length;assert.ok(activePixels>90);
    await page.screenshot({path:out+'/'+name+'.png'});
    report.push({name,date,physicalModel:b.physicalModel,positionErrorKm,textureWidth:b.textureWidth,activePixels,landingCount:s.landing.length,errors,years});
    await context.close();
  }
} finally {await browser.close();provider.dispose();}
await writeFile(out+'/report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
