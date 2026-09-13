import {loadYear} from './load-ephemeris.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, MathUtils } from 'three';
import { landingSites, surfaceFrame, angularDiameter, horizonAngles, lookDirection } from '../src/surface/geometry.js';

test('Apollo 15 Sun and Earth positions agree with independent ALSJ tables', () => {
  // Scotti/Fjeld table, EVA 2 start and EVA 3 start. Includes a different date
  // from the panorama to catch a fixed Earth direction or wrong spin sign.
  // https://apollojournals.org/alsj/alsj-EarthSun_AltAz.html
  for (const [date,sunAlt,sunAz,earthAlt,earthAz] of [
    ['1971-08-01T11:48:49Z',28.89,105.41,68.52,205.83],
    ['1971-08-02T08:52:14Z',37.98,112.20,67.91,206.23],
  ]) {
    const f = surfaceFrame(landingSites.moon,new Date(date));
    const sun=horizonAngles(f.targets.Sun.direction),earth=horizonAngles(f.targets.Earth.direction);
    for (const [actual,expected] of [[sun.altitude,sunAlt],[sun.azimuth,sunAz],[earth.altitude,earthAlt],[earth.azimuth,earthAz]])
      assert.ok(Math.abs(actual-expected)<.3, `${actual} vs ${expected}`);
  }
});

test('surface frames preserve angles and form a right-handed orthonormal basis', () => {
  for (const site of Object.values(landingSites)) {
    const f=surfaceFrame(site), axes=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(f.local);
    assert.ok(Math.abs(f.rotation.determinant()-1)<1e-12);
    for (const axis of axes) assert.ok(Math.abs(axis.length()-1)<1e-12);
    assert.ok(Math.abs(axes[0].dot(axes[1]))<1e-12);
    assert.ok(Math.abs(f.observer.distanceTo(f.center)*149597870.7-site.radiusKm-.00165)<1e-6);
  }
});

test('Earth and Jupiter retain physical angular size at both landing sites', () => {
  const moon=surfaceFrame(landingSites.moon),europa=surfaceFrame(landingSites.europa);
  const earthSize=MathUtils.radToDeg(angularDiameter(6371.0084,moon.targets.Earth.distanceKm));
  const jupiterSize=MathUtils.radToDeg(angularDiameter(69911,europa.targets.Jupiter.distanceKm));
  assert.ok(earthSize>1.8&&earthSize<2.0);
  assert.ok(jupiterSize>11&&jupiterSize<13);
  assert.ok(horizonAngles(europa.targets.Jupiter.direction).altitude>25&&horizonAngles(europa.targets.Jupiter.direction).altitude<31);
  assert.ok(horizonAngles(europa.targets.Sun.direction).altitude>9&&horizonAngles(europa.targets.Sun.direction).altitude<15);
  assert.throws(()=>angularDiameter(100,50),RangeError);
});

test('looking around covers all bearings without changing radius', () => {
  for(const heading of [-360,0,45,90,180,270,359,720])for(const pitch of [-85,0,45,89]){
    const look=lookDirection(heading,pitch),angles=horizonAngles(look);
    assert.ok(Math.abs(look.length()-1)<1e-12);
    assert.ok(Math.abs(angles.altitude-pitch)<1e-9);
    assert.ok(Math.abs(angles.azimuth-MathUtils.euclideanModulo(heading,360))<1e-9);
  }
});
