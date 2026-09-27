import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Vector3, MathUtils} from 'three';
import {prepareSurfaceTests} from './physical-fixture.js';
import {angularDiameter, landingSites, surfaceFrame, sunHiddenByParent} from '../src/surface/geometry.js';

const reference = JSON.parse(await readFile(new URL('phobos-eclipse-reference.json', import.meta.url), 'utf8'));
const oldMoment = reference.samples.find(sample => sample.date === '2026-09-27T00:39:00Z');
before(prepareSurfaceTests);

test('Phobos eclipse decision boundary matches independent UTC Horizons and PCK limb radii', () => {
  const {center} = oldMoment, {radiiKm} = reference;
  const sun = {radiusKm:radiiKm.sunPck, distanceKm:center.sunDistanceKm, direction:new Vector3()};
  const mars = {radiusKm:radiiKm.marsPckEquatorial, distanceKm:center.marsDistanceKm, direction:new Vector3(0,0,1)};
  const frame = {targets:{Sun:sun, Mars:mars}}, site = {parent:'Mars'};
  // Measure the public predicate's boundary, not just the angular-size helper.
  // Reintroducing atan only inside sunHiddenByParent must fail this test.
  let hidden = 0, clear = Math.PI;
  for (let i=0; i<60; i++) {
    const angle = (hidden+clear)/2;
    sun.direction.set(Math.sin(angle),0,Math.cos(angle));
    if (sunHiddenByParent(frame,site)) hidden=angle; else clear=angle;
  }
  const boundary = MathUtils.radToDeg((hidden+clear)/2);
  // Explicit UTC yields 21.31700552 deg, including the 0.17152965 deg Sun.
  assert.ok(Math.abs(boundary-21.3170055203941)<.002, 'decision boundary '+boundary+' deg');
  assert.ok(Math.abs(boundary-center.thresholdDeg)<1e-9);
  assert.ok(Math.abs(MathUtils.radToDeg(angularDiameter(mars.radiusKm,mars.distanceKm)/2)-center.marsRadiusDeg)<1e-9);
  assert.ok(Math.abs(MathUtils.radToDeg(angularDiameter(sun.radiusKm,sun.distanceKm)/2)-center.sunRadiusDeg)<1e-9);
});

test('the rejected 00:39 UTC moment is still eclipsed at both Phobos sites', () => {
  for (const siteId of ['phobos-60e','phobos-311e']) {
    const site=landingSites[siteId], expected=oldMoment.sites[siteId].meanSphere;
    const frame=surfaceFrame(site,new Date(oldMoment.date));
    assert.equal(expected.eclipsed,true,siteId);
    assert.equal(expected.oldEclipsed,false,siteId+': this sample must expose the old formula');
    assert.equal(sunHiddenByParent(frame,site),true,siteId+': 00:39 has not fully cleared Mars');
    assert.ok(Math.abs(MathUtils.radToDeg(frame.targets.Sun.direction.angleTo(frame.targets.Mars.direction))-expected.separationDeg)<.01);
  }
});

test('the eclipse predicate includes partial overlap on either side of the true limb', () => {
  const {center}=oldMoment;
  const sun={radiusKm:reference.radiiKm.sunPck,distanceKm:center.sunDistanceKm,direction:new Vector3()};
  const mars={radiusKm:reference.radiiKm.marsPckEquatorial,distanceKm:center.marsDistanceKm,direction:new Vector3(0,0,1)};
  const frame={targets:{Sun:sun,Mars:mars}};
  for (const [separation,expected] of [[0,true],[center.marsRadiusDeg,true],[center.thresholdDeg-.01,true],[center.thresholdDeg+.01,false]]) {
    const angle=MathUtils.degToRad(separation);
    sun.direction.set(Math.sin(angle),0,Math.cos(angle));
    assert.equal(sunHiddenByParent(frame,{parent:'Mars'}),expected,separation+' deg');
  }
  assert.equal(sunHiddenByParent(frame,{parent:'Sun'}),false);
  assert.equal(sunHiddenByParent({targets:{Sun:sun}},{parent:'Mars'}),false);
});
