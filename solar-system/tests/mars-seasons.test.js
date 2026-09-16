import test from 'node:test';
import assert from 'node:assert/strict';
import {marsSolarLongitude, marsPolarFrostEdges} from '../src/mars-seasons.js';

test('the solar longitude runs through the seasons in order', () => {
  // L_s advances by roughly 0.5 degrees per day over a 687-day year.
  const start = marsSolarLongitude(new Date('2026-01-01T00:00:00Z'));
  const later = marsSolarLongitude(new Date('2026-03-01T00:00:00Z'));
  const advance = (later - start + 360) % 360;
  assert.ok(advance > 20 && advance < 40, `59 days should advance L_s by about 31 degrees, got ${advance.toFixed(1)}`);
  for (const iso of ['2026-01-01T00:00:00Z', '2027-06-15T00:00:00Z', '2030-11-30T00:00:00Z']) {
    const value = marsSolarLongitude(new Date(iso));
    assert.ok(value >= 0 && value < 360, `${iso}: ${value}`);
  }
});

test('each cap is widest in its own winter, and the south one disappears', () => {
  const northernWinter = marsPolarFrostEdges(270);
  const northernSummer = marsPolarFrostEdges(90);
  assert.ok(Math.abs(northernWinter.northLatitude - 55) < .01, `north edge in winter ${northernWinter.northLatitude}`);
  assert.ok(Math.abs(northernSummer.northLatitude - 80) < .01, `north edge in summer ${northernSummer.northLatitude}`);
  // The north cap never vanishes; the measured remnant is why the winter edge stops at 55N.
  assert.ok(marsPolarFrostEdges(0).northLatitude < 80 && marsPolarFrostEdges(0).northLatitude > 55);
  assert.ok(Math.abs(northernSummer.southLatitude + 55) < .01, `south edge in southern winter ${northernSummer.southLatitude}`);
  assert.ok(Math.abs(northernWinter.southLatitude + 87) < .01, `south edge in southern summer ${northernWinter.southLatitude}`);
  // In southern summer the south cap's CO2 is gone, so its edge is the residual water-ice cap.
  assert.ok(marsPolarFrostEdges(270).southLatitude < -80);
  // Everywhere in the year the two edges stay inside their hemispheres and do not cross.
  for (let ls = 0; ls < 360; ls += 15) {
    const {northLatitude, southLatitude} = marsPolarFrostEdges(ls);
    assert.ok(northLatitude > 40 && northLatitude <= 80, `L_s ${ls}: north ${northLatitude}`);
    assert.ok(southLatitude < -40 && southLatitude >= -87, `L_s ${ls}: south ${southLatitude}`);
  }
});
