import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3} from 'three';
import {landingSites,surfaceFrame,surfaceSunDirection} from '../src/surface/geometry.js';
import {solarVisibility,surfaceSkyDistance} from '../src/surface/SurfaceSky.js';
import {localPhysics} from './physical-fixture.js';
import {skyDepthParameters,skyDepthValue} from '../src/surface/sky-depth.js';

test('every landing sky and its physical illumination agree with independent DE440/Horizons/CSPICE references',async()=>{
  const {fixtures}=JSON.parse(await readFile(new URL('ground-audit-reference.json',import.meta.url),'utf8'));
  // A site without samples is not covered, and the earlier count-of-bodies assertion could not
  // tell that apart from a second site on a body that already had one.
  const covered=new Set(fixtures.map(f=>f.siteId));
  const uncovered=Object.keys(landingSites).filter(id=>!covered.has(id));
  assert.deepEqual(uncovered,[],'landing sites missing independent samples');
  const provider=localPhysics(),maxima={};
  let partialEclipses=0;
  try {
    for(const sample of fixtures){
      const date=new Date(sample.date),site=landingSites[sample.siteId];
      assert.ok(site,`${sample.siteId}: reference sample for an unknown site`);
      assert.equal(site.id,sample.id,`${sample.siteId}: reference body no longer matches the site`);
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
        // Parent geometry that comes from the JPL satellite kernels (not AE's planetary theory)
        // is held to the tighter gate; charon's parent is Pluto, which the same kernel carries.
        // Earth is the one landing whose observer frame itself carries a model
        // difference: AE's GAST-of-date realization of Earth rotation (UT1≈UTC)
        // and CSPICE's IAU_EARTH polynomial fed TDB disagree by a few arcminutes,
        // growing with distance from J2000. Sun and moon directions inherit that
        // frame rotation almost equally (2.6′ at J2000, 14.3′ by 2100), so the
        // earth gate bounds the two realizations, not a body-position error.
        const jplParent=['enceladus','titan','miranda','pluto','charon'].includes(sample.id)&&name!=='sun';
        const earthSite=sample.siteId==='earth';
        const directionGate=jplParent ? .001 : earthSite ? 16 : name==='sun' ? 1 : 6;
        const diameterGate=jplParent ? .01 : earthSite ? 1 : name==='sun' ? 1 : 10;
        assert.ok(directionError<directionGate,`${sample.siteId}/${name}/${sample.date}: ${directionError} arcmin`);
        assert.ok(diameterError<diameterGate,`${sample.siteId}/${name}: ${diameterError} arcsec`);
        const metrics=maxima[sample.siteId]??={sunArcmin:0,parentArcmin:0,phaseFraction:0};
        const key=name==='sun'?'sunArcmin':'parentArcmin';
        metrics[key]=Math.max(metrics[key],directionError);
        if(name!=='sun'){
          const light=surfaceSunDirection(frame,target);
          const lightError=light.angleTo(new Vector3().fromArray(reference.sunDirection))*180/Math.PI*60;
          const illuminated=(1+light.dot(target.direction.clone().negate()))/2;
          const phaseError=Math.abs(illuminated-reference.illuminatedFraction);
          // The incident light is also expressed in the observer's local frame, so at
          // the earth site it inherits the same frame-rotation difference as above.
          assert.ok(lightError<(earthSite?16:1),`${sample.id}: incident light ${lightError} arcmin`);
          assert.ok(phaseError<.001,`${sample.id}: illuminated fraction ${phaseError}`);
          metrics.phaseFraction=Math.max(metrics.phaseFraction,phaseError);
        }
      }
    }
  } finally { provider.dispose(); }
  assert.ok(partialEclipses>=3,'independently selected eclipse samples include partial coverage');
  console.log(`Independent landing-site angular/phase maxima (${covered.size} sites):`,JSON.stringify(maxima));
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
