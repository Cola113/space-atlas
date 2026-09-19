import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/dynamics.js', import.meta.url), 'utf8');
const saturnFn = source.slice(
  source.indexOf('function saturnAtmosphereMap'),
  source.indexOf('function attachSolarSurface'),
);
const gasMapSrc = source.slice(source.indexOf('function gasMap'), source.indexOf('function saturnAtmosphereMap'));

test('Saturn keeps the dual-phase advection that stops the map stretching forever', () => {
  assert.ok(source.includes('const FLOW_PERIOD = 24'));
  assert.ok(source.includes('export const SATURN_ATMOSPHERE'));
  assert.ok(source.includes('flowPeriod: FLOW_PERIOD'));
  assert.ok(saturnFn.includes('flowCycle()'), 'Saturn must reuse the 24 s two-phase cycle');
  assert.ok(
    saturnFn.includes('sampleGlobe(map, uvB)') && saturnFn.includes('sampleGlobe(map, uvA)'),
    'Saturn must blend two globe samples the way Jupiter does',
  );
  assert.ok(!saturnFn.includes('stormCenter'), 'Saturn must not keep the generic oval that was never a Saturn feature');
  assert.ok(!saturnFn.includes('.20, .64'), 'the old placeholder storm UV must not remain on Saturn');
});

test('Saturn wind and polar shapes follow observed features, with display-scaled motion', () => {
  assert.ok(source.includes('hexagonApothem: 0.180'));
  assert.ok(source.includes('hexagonLatitudeDeg: 78'));
  assert.ok(source.includes('ribbonLatitudeDeg: 47'));
  assert.ok(source.includes('equatorialDrift: 0.006'));
  assert.ok(saturnFn.includes('hexRadius') && saturnFn.includes('0.180'), 'hexagon apothem stays at the sourced 78°N figure');
  assert.ok(saturnFn.includes('hexWave'), 'hexagon sides must meander rather than sit as a still overlay');
  assert.ok(saturnFn.includes('southEye') && saturnFn.includes('southWall'), 'south polar vortex must be drawn');
  assert.ok(saturnFn.includes('eqJet') && saturnFn.includes('ribbon'), 'zonal jet and 47°N ribbon must be present');
  assert.ok(saturnFn.includes('streaks'), 'ammonia-ice streaks carry motion on the low-contrast map');
});

test('Jupiter still uses gasMap with the Great Red Spot and differential belts', () => {
  const settings = gasMapSrc.slice(gasMapSrc.indexOf('jupiter:'), gasMapSrc.indexOf('uranus:'));
  assert.ok(settings.includes('bands: 28'));
  assert.ok(settings.includes('drift: 0.0014'));
  assert.ok(settings.includes('".365", ".39"'));
  assert.ok(settings.includes('swirl: 0.085'));
  assert.ok(
    source.includes('map_fragment: body.id === "saturn" ? saturnAtmosphereMap() : gasMap(body.id)'),
    'only Saturn should leave the shared gasMap path',
  );
  assert.ok(gasMapSrc.includes('vortexUv(flowUv + wind * cycle.x'), 'Jupiter still swirls the Great Red Spot');
});

test('Saturn activity copy names the hexagon and differential flow as schematic', () => {
  const saturn = source.slice(source.indexOf('saturn: {'), source.indexOf('uranus: {'));
  assert.match(saturn, /六边形/);
  assert.match(saturn, /示意/);
  assert.match(saturn, /差速云流/);
});

test('the selected primary keeps full globe-flow detail in its system view', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.ok(main.includes('system: state.system'), 'system view must be passed into dynamics');
  assert.ok(main.includes('selected: state.selected'), 'the primary id must still be passed in system view');
  assert.ok(!main.includes('selected: state.system ? null : state.selected'),
    'nulling the selection in 土星系 would leave Saturn at 0.12 detail, which does not read on the gold map');
  assert.ok(source.includes('system && id === selected'), 'globe-flow detail follows the selected primary');
});
