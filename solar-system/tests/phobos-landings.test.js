import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {prepareSurfaceTests} from './physical-fixture.js';
import {landingSites, surfaceFrame, horizonAngles, nextDaylight, sunHiddenByParent} from '../src/surface/geometry.js';

before(prepareSurfaceTests);

const eclipseReference=JSON.parse(await readFile(new URL('phobos-eclipse-reference.json',import.meta.url),'utf8'));

test('Phobos panoramas preserve opaque crater shadows below the skyline',async()=>{
  for(const id of ['phobos-60e','phobos-311e']){
    const file=await readFile(new URL(`../../public${landingSites[id].texture}`,import.meta.url));
    const {data,info}=await sharp(file).extractChannel(3).raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,3840,id);assert.equal(info.height,1920,id);
    assert.ok(data.subarray(0,info.width*96).every(alpha=>alpha===0),`${id}: zenith sky must be transparent`);
    for(let x=0;x<info.width;x++){
      let firstOpaque=-1;
      for(let y=0;y<info.height;y++){
        const alpha=data[y*info.width+x];
        if(firstOpaque<0&&alpha===255)firstOpaque=y;
        // Leave the narrow antialiasing and resampling band at the skyline.
        if(firstOpaque>=0&&y>firstOpaque+16)assert.equal(alpha,255,`${id}: terrain hole at ${x},${y}`);
      }
      assert.ok(firstOpaque>=0,`${id}: missing ground column ${x}`);
    }
    for(let y=0;y<info.height;y++)assert.equal(data[y*info.width],data[y*info.width+info.width-1],`${id}: alpha seam`);
  }
});

test('both Phobos default moments and daylight jumps are sunlit outside Mars shadow',()=>{
  for(const id of ['phobos-60e','phobos-311e']){
    const site=landingSites[id],start=Date.parse(site.date),daylight=nextDaylight(site,start);
    assert.ok(Number.isFinite(daylight),`${id}: no daylight moment`);
    for(const time of [start,daylight]){
      const frame=surfaceFrame(site,new Date(time));
      assert.ok(horizonAngles(frame.targets.Sun.direction).altitude>8,`${id}: Sun must be above 8 degrees`);
      assert.equal(sunHiddenByParent(frame,site),false,`${id}: visible Sun must not be eclipsed by Mars`);
    }
  }
});

test('both Phobos defaults retain at least ten minutes after complete independent eclipse egress',()=>{
  for(const id of ['phobos-60e','phobos-311e']){
    const site=landingSites[id],time=Date.parse(site.date);
    const reference=eclipseReference.candidates.find(candidate=>candidate.siteId===id);
    assert.equal(time,Date.parse(reference.date),id+': unverified default epoch');
    assert.ok(reference.meanSphere.sunAltitudeDeg>8);
    assert.equal(reference.meanSphere.eclipsed,false);
    assert.equal(reference.equatorialSphere.eclipsed,false);
    assert.ok(reference.minimumMinutesAfterEgress>=10);
    const brackets=eclipseReference.egress.sites[id];
    for(const bracket of Object.values(brackets))assert.ok(time-Date.parse(bracket[1])>=600000);
    // A start/end check alone could miss an intervening eclipse. Sample the
    // application's full buffer and check independent minute samples as well.
    for(let offset=0;offset<=600000;offset+=15000){
      const frame=surfaceFrame(site,new Date(time-offset));
      assert.equal(sunHiddenByParent(frame,site),false,id+': eclipse within the ten-minute buffer');
      if(offset%60000===0){
        const sample=eclipseReference.samples.find(row=>Date.parse(row.date)===time-offset);
        assert.ok(sample,id+': missing independent buffer sample');
        assert.equal(sample.sites[id].meanSphere.eclipsed,false);
        assert.equal(sample.sites[id].equatorialSphere.eclipsed,false);
      }
    }
  }
});
