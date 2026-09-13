import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3} from 'three';
import {landingSites,surfaceFrame,surfaceSunDirection} from '../src/surface/geometry.js';
import {solarVisibility,surfaceSkyDistance} from '../src/surface/SurfaceSky.js';
import {localPhysics} from './physical-fixture.js';
import {skyDepthParameters,skyDepthValue} from '../src/surface/sky-depth.js';

test('nine landing skies and physical illumination agree with independent DE440/Horizons/CSPICE references',async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL('ground-audit-reference.json',import.meta.url),'utf8'));
  assert.equal(new Set(fixtures.map(f=>f.id)).size,9);
  const provider=localPhysics(),maxima={};
  let partialEclipses=0;
  try {
    for(const sample of fixtures){
      const date=new Date(sample.date),site=landingSites[sample.id];
      await provider.ensure(date,[sample.id],{prefetch:false});
      const frame=surfaceFrame(site,date,provider);
      if(sample.visibleSolarFraction!==undefined){
        const visible=solarVisibility({targets:{Sun:frame.targets.Sun,[site.parent]:frame.targets[site.parent]}},site.parentRadiusKm,site.parent);
        // AE supplies the Saturn system's solar translation: finite sky error
        // affects contact times even when local JPL encoding is centimetric.
        assert.ok(Math.abs(visible-sample.visibleSolarFraction)<.08,`${sample.id}/${sample.date}: eclipse fraction ${visible} vs ${sample.visibleSolarFraction}`);
        if(sample.visibleSolarFraction>0&&sample.visibleSolarFraction<1)partialEclipses++;
      }
      for(const [name,reference] of Object.entries(sample.targets)){
        const target=Object.values(frame.targets).find(t=>t.id===name);
        const directionError=target.direction.angleTo(new Vector3().fromArray(reference.direction))*180/Math.PI*60;
        const diameterError=Math.abs(target.angularDiameter-reference.angularDiameter)*180/Math.PI*3600;
        // These are angular model gates, not the unrelated 1 km encoding gate.
        // AE's short planetary/lunar theories are compared in the local sky;
        // its advertised geocentric accuracy is not a surface-satellite bound.
        const jplParent=['enceladus','titan','miranda','pluto'].includes(sample.id)&&name!=='sun';
        assert.ok(directionError<(jplParent ? .001 : name==='sun' ? 1 : 6),`${sample.id}/${name}/${sample.date}: ${directionError} arcmin`);
        assert.ok(diameterError<(jplParent ? .01 : name==='sun' ? 1 : 10),`${sample.id}/${name}: ${diameterError} arcsec`);
        const metrics=maxima[sample.id]??={sunArcmin:0,parentArcmin:0,phaseFraction:0};
        const key=name==='sun'?'sunArcmin':'parentArcmin';
        metrics[key]=Math.max(metrics[key],directionError);
        if(name!=='sun'){
          const light=surfaceSunDirection(frame,target);
          const lightError=light.angleTo(new Vector3().fromArray(reference.sunDirection))*180/Math.PI*60;
          const illuminated=(1+light.dot(target.direction.clone().negate()))/2;
          const phaseError=Math.abs(illuminated-reference.illuminatedFraction);
          assert.ok(lightError<1,`${sample.id}: incident light ${lightError} arcmin`);
          assert.ok(phaseError<.001,`${sample.id}: illuminated fraction ${phaseError}`);
          metrics.phaseFraction=Math.max(metrics.phaseFraction,phaseError);
        }
      }
    }
  } finally { provider.dispose(); }
  assert.ok(partialEclipses>=3,'independently selected eclipse samples include partial coverage');
  console.log('Independent nine-site angular/phase maxima:',JSON.stringify(maxima));
});

test('local moons dim a planetary landing during transit, without counting overlapping disks twice',()=>{
  const direction=new Vector3(0,1,0),sunDistance=200000000,r=Math.asin(695700/sunDistance);
  const moon={direction:direction.clone(),distanceKm:10000,radiusKm:Math.sin(r/2)*10000};
  const frame={targets:{Sun:{direction,distanceKm:sunDistance},Phobos:moon}};
  assert.ok(Math.abs(solarVisibility(frame,695700,'Sun')-.75)<1e-10);
  frame.targets.Deimos={...moon,direction:direction.clone()};
  assert.ok(Math.abs(solarVisibility(frame,695700,'Sun')-.75)<.0001,'coincident disks form one covered area');
  frame.targets.Phobos.distanceKm=3e8;frame.targets.Deimos.distanceKm=3e8;
  assert.equal(solarVisibility(frame,695700,'Sun'),1,'objects beyond the Sun cast no foreground eclipse');
});

test('sky depth preserves the ordering of a Sun transit and a planet behind the Sun',()=>{
  const au=149597870.7;
  assert.ok(surfaceSkyDistance(.7*au)<surfaceSkyDistance(au));
  assert.ok(surfaceSkyDistance(1.3*au)>surfaceSkyDistance(au));
  for(const distance of [10000,au,100*au]){
    const display=surfaceSkyDistance(distance),radius=1000;
    assert.ok(Math.abs(2*Math.asin((display*radius/distance)/display)-2*Math.asin(radius/distance))<1e-12);
  }
});

test('physical fragment depth separates the thin terrestrial cloud shell from its surface',()=>{
  const parameters=skyDepthParameters([{distanceKm:384400,radiusKm:6371},{distanceKm:2e10,radiusKm:1000}]);
  const surface=skyDepthValue(384400-6371,parameters),cloud=skyDepthValue(384400-6371*1.003,parameters);
  assert.ok(surface-cloud>4/(2**24),'cloud shell retains several depth-buffer levels');
  assert.ok(cloud>.91&&surface<.99,'celestial band remains behind terrain and ahead of stars');
});
