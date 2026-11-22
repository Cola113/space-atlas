import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MathUtils, Object3D, Mesh, SphereGeometry, MeshBasicMaterial } from 'three';
import { prepareSurfaceTests } from './physical-fixture.js';
import {
  SONGBIRD_DEFAULT_DATE,
  isSongbird2077Active,
  earthMoonL1Fraction,
  computeEarthMoonL1,
  computeTychoEchoOnMoon,
  easterEggLandingSites,
  matchesSongbirdQuery,
  createCrystalPalaceMesh,
} from '../src/easter-eggs/songbird-2077.js';
import { landingSites, resolveLandingSite, surfaceFrame, horizonAngles, angularDiameter } from '../src/surface/geometry.js';
import { landmarks, landmarkFrame } from '../src/landmarks.js';
import { surfaceLight } from '../src/surface/SurfaceSky.js';

before(prepareSurfaceTests);

test('2077 time gate toggles cleanly at the 2077 UTC year boundary', () => {
  assert.equal(isSongbird2077Active('1971-08-01T17:00:00Z'), false);
  assert.equal(isSongbird2077Active('2026-09-27T05:30:00Z'), false);
  assert.equal(isSongbird2077Active('2076-12-31T23:59:59Z'), false);
  assert.equal(isSongbird2077Active('2077-01-01T00:00:00Z'), true);
  assert.equal(isSongbird2077Active(SONGBIRD_DEFAULT_DATE), true);
  assert.equal(isSongbird2077Active('2099-05-01T00:00:00Z'), true);
});

test('Earth-Moon L1 ratio satisfies the restricted three-body Euler quintic to high precision', () => {
  const { mu, moonFraction, earthFraction } = earthMoonL1Fraction();
  assert.ok(mu > 0.012 && mu < 0.0123, `unexpected Earth-Moon mass ratio ${mu}`);
  assert.ok(Math.abs(moonFraction + earthFraction - 1) < 1e-15);
  assert.ok(moonFraction > 0.150 && moonFraction < 0.152, `unexpected L1 moon fraction ${moonFraction}`);
  const residual = (1 - mu) / ((1 - moonFraction) ** 2) - mu / (moonFraction ** 2) - (1 - mu - moonFraction);
  assert.ok(Math.abs(residual) < 1e-11, `L1 quintic residual too large: ${residual}`);
});

test('easter-egg Tycho site resolves cleanly without mutating the 21 scientific landingSites', async () => {
  assert.equal(Object.keys(landingSites).length, 21);
  assert.equal(landingSites['moon-tycho'], undefined);
  const site = resolveLandingSite('moon-tycho');
  assert.ok(site && site.siteId === 'moon-tycho' && site.id === 'moon');
  assert.equal(resolveLandingSite('moon'), landingSites.moon);

  const webp = await readFile(new URL(`../../public${site.texture}`, import.meta.url));
  assert.equal(webp.toString('ascii', 8, 12), 'WEBP');
  const pin = await readFile(new URL('../../public/solar-system/easter-eggs/tycho-pin.png', import.meta.url));
  assert.equal(pin.readUInt32BE(0), 0x89504e47);
  const emblem = await readFile(new URL('../../public/solar-system/easter-eggs/crystal-palace-emblem.png', import.meta.url));
  assert.equal(emblem.readUInt32BE(0), 0x89504e47);

  const frame = surfaceFrame(site, new Date(site.date));
  assert.equal(frame.targets.Moon, undefined, 'lunar site must not draw Moon in its own sky');
  const sunAlt = horizonAngles(frame.targets.Sun.direction).altitude;
  const earthAlt = horizonAngles(frame.targets.Earth.direction).altitude;
  const earthDeg = MathUtils.radToDeg(angularDiameter(site.parentRadiusKm, frame.targets.Earth.distanceKm));
  assert.ok(sunAlt > 10 && sunAlt < 26, `expected raking daylight at Tycho epoch, got ${sunAlt}`);
  assert.ok(earthAlt > 34 && earthAlt < 52, `expected Earth high in northern Tycho sky, got ${earthAlt}`);
  assert.ok(earthDeg > 1.75 && earthDeg < 2.05, `unexpected Earth angular diameter ${earthDeg}`);
  assert.ok(Number.isFinite(surfaceLight(frame, site, site.referenceSolarAltitude).brightness));
});

test('Earth-Moon L1 Crystal Palace sits near Earth limb from both nearside lunar sites and stays hidden on far side', () => {
  const date = new Date(SONGBIRD_DEFAULT_DATE);
  for (const siteId of ['moon-tycho', 'moon']) {
    const site = resolveLandingSite(siteId);
    const frame = surfaceFrame(site, date);
    const l1 = computeEarthMoonL1(frame, { halo: true });
    assert.ok(l1, `${siteId}: missing L1 computation`);
    assert.ok(l1.moonDistanceKm > 52000 && l1.moonDistanceKm < 64000, `${siteId}: L1 moon distance ${l1.moonDistanceKm}`);
    assert.ok(horizonAngles(l1.direction).altitude > 30, `${siteId}: L1 should stand high above horizon`);
    const separationDeg = MathUtils.radToDeg(l1.direction.angleTo(frame.targets.Earth.direction));
    assert.ok(separationDeg > 0.7 && separationDeg < 3.5, `${siteId}: L1 separation from Earth center ${separationDeg.toFixed(2)} deg`);
  }
  const farsideFrame = surfaceFrame(landingSites['moon-farside'], date);
  const farsideL1 = computeEarthMoonL1(farsideFrame, { halo: true });
  assert.ok(horizonAngles(farsideL1.direction).altitude < -30, 'L1 must remain below horizon on the far side');
});

test('Earth Mauna Kea Tycho echo targets the visible southern lunar limb', () => {
  const earthSite = landingSites.earth;
  // Pick a 2077 instant when Moon is up over Mauna Kea
  let checked = false;
  for (let h = 0; h < 48; h += 2) {
    const date = new Date(Date.UTC(2077, 5, 12, h, 0, 0));
    const frame = surfaceFrame(earthSite, date);
    if (horizonAngles(frame.targets.Moon.direction).altitude > 15) {
      const echo = computeTychoEchoOnMoon(frame);
      assert.ok(echo, 'Tycho should face Earth from the lunar nearside');
      const offsetDeg = MathUtils.radToDeg(echo.direction.angleTo(frame.targets.Moon.direction));
      const moonRadiusDeg = MathUtils.radToDeg(frame.targets.Moon.angularDiameter) / 2;
      assert.ok(offsetDeg > moonRadiusDeg * 0.45 && offsetDeg <= moonRadiusDeg * 1.05,
        `Tycho offset ${offsetDeg.toFixed(3)} deg should sit inside Moon radius ${moonRadiusDeg.toFixed(3)} deg`);
      checked = true;
      break;
    }
  }
  assert.ok(checked, 'failed to find a 2077 window with the Moon above Mauna Kea');
});

test('Moon landmarks and Atlas easter-egg search keywords behave consistently', () => {
  assert.ok(Array.isArray(landmarks.moon) && landmarks.moon.length === 3);
  const root = new Object3D();
  const mesh = new Mesh(new SphereGeometry(1, 32, 24), new MeshBasicMaterial());
  root.add(mesh);
  const body = { id: 'moon', root, mesh };
  for (const id of ['tycho', 'mare-tranquillitatis']) {
    const feature = landmarks.moon.find(f => f.id === id);
    const frame = landmarkFrame(feature, body);
    assert.ok(frame && Math.abs(frame.direction.length() - 1) < 1e-10);
  }
  const cpFeature = landmarks.moon.find(f => f.id === 'crystal-palace-l1');
  assert.equal(landmarkFrame(cpFeature, body), null, 'L1 station landmark stays hidden without active 2077 anchor');

  assert.equal(matchesSongbirdQuery('百灵鸟'), true);
  assert.equal(matchesSongbirdQuery('Songbird'), true);
  assert.equal(matchesSongbirdQuery('水晶宫'), true);
  assert.equal(matchesSongbirdQuery('2077'), true);
  assert.equal(matchesSongbirdQuery('地球'), false);
  assert.equal(matchesSongbirdQuery('207'), false);
  assert.equal(matchesSongbirdQuery('pal'), false);
  assert.equal(matchesSongbirdQuery('bird'), false);
  assert.equal(matchesSongbirdQuery('a'), false);
  assert.equal(easterEggLandingSites['moon-tycho'].siteId, 'moon-tycho');

  const station = createCrystalPalaceMesh({ scale: 1, includeHalo: true });
  const litMaterials = station.materials.filter((m) => m.isMeshStandardMaterial);
  assert.ok(litMaterials.length >= 4, 'Crystal Palace hull should use physically lit materials');
  assert.ok(litMaterials.some((m) => Boolean(m.emissiveMap)), 'Crystal Palace rings should carry cabin-window emissive texture');
  station.step(3.5, 0.25);
  station.dispose();

  mesh.geometry.dispose();
  mesh.material.dispose();
});
