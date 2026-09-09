import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { Vector, Ecliptic, MakeTime } from 'astronomy-engine';
import { skyRotation, equatorialDirection, galacticUv, starAppearance, skyExposure, DISPLAY_LONGITUDE_OFFSET } from '../src/sky-coordinates.js';

test('catalogue directions use the same dated ecliptic orientation as the planets, without mirroring', () => {
  for (const iso of ['2000-01-01T12:00:00Z', '2026-09-09T00:00:00Z', '2100-06-21T00:00:00Z']) {
    const date = new Date(iso), rotation = skyRotation(date);
    assert.ok(Math.abs(rotation.determinant() - 1) < 1e-12);
    for (const [ra, dec] of [[0, 0], [Math.PI / 2, 0], [1.76779537, -0.29175126], [0.66, 1.55795]]) {
      const equatorial = equatorialDirection(ra, dec);
      const ecliptic = Ecliptic(new Vector(equatorial.x, equatorial.y, equatorial.z, MakeTime(date)));
      const longitude = ecliptic.elon * Math.PI / 180 - DISPLAY_LONGITUDE_OFFSET;
      const latitude = ecliptic.elat * Math.PI / 180;
      const expected = new Vector3(Math.cos(longitude) * Math.cos(latitude), Math.sin(latitude), -Math.sin(longitude) * Math.cos(latitude));
      assert.ok(equatorial.applyMatrix3(rotation).distanceTo(expected) < 1e-12);
    }
  }
});

test('Gaia texture is centred on the Galactic centre, with north up and Magellanic Clouds on the right', () => {
  const radians = Math.PI / 180;
  const center = galacticUv(equatorialDirection(266.4051 * radians, -28.936175 * radians));
  assert.ok(Math.abs(center[0] - 0.5) < 0.001);
  assert.ok(Math.abs(center[1] - 0.5) < 0.001);
  const north = galacticUv(equatorialDirection(192.85948 * radians, 27.12825 * radians));
  assert.ok(north[1] > 0.999);
  const lmc = galacticUv(equatorialDirection(80.894 * radians, -69.756 * radians));
  assert.ok(lmc[0] > 0.71 && lmc[0] < 0.74 && lmc[1] > 0.30 && lmc[1] < 0.33);
});

test('packaged bright-star catalogue preserves known stars, magnitude order and excludes the Sun', () => {
  const data = JSON.parse(readFileSync(new URL('../../public/solar-system/sky/hyg-v41-mag65.json', import.meta.url), 'utf8'));
  assert.equal(data.stars.length, 8920);
  assert.equal(new Set(data.stars.map(row => row[0])).size, data.stars.length);
  assert.ok(data.stars.every(row => row[0] !== 0 && row[3] <= 6.5 && row[1] >= 0 && row[1] < Math.PI * 2 && Math.abs(row[2]) <= Math.PI / 2));
  const sirius = data.stars.find(row => row[0] === 32263);
  assert.equal(sirius[3], -1.44);
  assert.ok(Math.abs(sirius[1] * 12 / Math.PI - 6.7525) < 0.0001);
  assert.ok(Math.abs(sirius[2] * 180 / Math.PI + 16.7161) < 0.0001);
  assert.ok(data.stars.some(row => row[0] === 11734));
  let previous = Infinity;
  for (const row of data.stars) {
    const display = starAppearance(row[3], row[4]);
    assert.ok(display.brightness <= previous);
    assert.ok(display.size <= 1.85 && display.size >= 1);
    previous = display.brightness;
  }
  assert.ok(skyExposure(0.35) < skyExposure(0.1));
  assert.equal(skyExposure(0), 1);
});
