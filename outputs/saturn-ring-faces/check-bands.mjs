// Narrow radial bands, so the optical depth under a band is nearly one value, and the
// model's unlit/lit ratio can be compared with the pixels. The model is the shader's own
// formula: reflection with the opposition surge on the sunlit face, transmission without
// it on the other, both with the real phase function on the first order.
import { tableAngles } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const table = JSON.parse(readFileSync(new URL('../../solar-system/src/ring-scattering.json', import.meta.url), 'utf8'));
const faces = JSON.parse(readFileSync(new URL('faces.json', import.meta.url), 'utf8'));
const angles = tableAngles();
const nearest = t => angles.reduce((best, a) => Math.abs(a - t) < Math.abs(best - t) ? a : best, angles[0]);
const hg = (cosAlpha, g) => (1 - g * g) / (1 + g * g + 2 * g * cosAlpha) ** 1.5;
const G = -0.3;                       // RING_PHASE_G
const EQUATORIAL = 60268;             // km, the table's radius unit
const bands = [[1.28, 1.33], [1.72, 1.77], [2.08, 2.13]];

// Region covering a band: the shipped table is one row per declared region, in radius
// order, and ring-regions.json carries the radii again.
const declared = JSON.parse(readFileSync(new URL('../../solar-system/src/ring-regions.json', import.meta.url), 'utf8')).regions;
const saturn = table.systems.saturn.regions;
const regionAt = ratio => {
  const km = ratio * EQUATORIAL;
  const index = declared.findIndex(([, innerKm, outerKm]) => innerKm <= km && km < outerKm);
  return saturn[index < 0 ? saturn.length - 1 : index];
};

const linear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const measure = async (record, inner, outer) => {
  const { data, info } = await sharp(fileURLToPath(new URL(`face-${record.date}-${record.pole}-noshadow.png`, new URL('./', import.meta.url)))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, n = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const r = Math.hypot(x + .5 - record.x, y + .5 - record.y) / record.radiusPx;
    if (r < inner || r > outer) continue;
    const i = (y * info.width + x) * info.channels;
    sum += linear((data[i] + data[i + 1] + data[i + 2]) / 3 / 255); n++;
  }
  return n ? sum / n : 0;
};

for (const iso of ['2002-10-01']) {
  const unlit = faces.find(f => f.iso === iso && !f.lit), lit = faces.find(f => f.iso === iso && f.lit);
  const elevation = Math.abs(unlit.sunElevation) * Math.PI / 180;
  const mu0 = Math.sin(elevation);
  console.log(`${iso}: sun elevation ${unlit.sunElevation} deg, mu0 = ${mu0.toFixed(3)}`);
  for (const [inner, outer] of bands) {
    const middle = (inner + outer) / 2;
    const region = regionAt(middle);
    const mu = Math.cos(Math.atan(middle / 11));
    const cosAlpha = mu * mu0;              // azimuth-averaged: the camera is on the axis
    const K = region.x[angles.indexOf(nearest(mu))] * region.x[angles.indexOf(nearest(mu0))] - region.y[angles.indexOf(nearest(mu))] * region.y[angles.indexOf(nearest(mu0))];
    const A = region.x[angles.indexOf(nearest(mu))] * region.y[angles.indexOf(nearest(mu0))] - region.y[angles.indexOf(nearest(mu))] * region.x[angles.indexOf(nearest(mu0))];
    const slab = 1 - Math.exp(-region.tau * (1 / mu + 1 / mu0));
    const reflected = mu0 / (mu + mu0) * (K + 0.25 * region.albedo * slab * (hg(cosAlpha, G) - 1));
    const transmitted = mu0 / (mu - mu0) * (A + 0.25 * region.albedo * (Math.exp(-region.tau / mu) - Math.exp(-region.tau / mu0)) * (hg(-cosAlpha, G) - 1));
    const unlitPixels = await measure(unlit, inner, outer), litPixels = await measure(lit, inner, outer);
    console.log(`  ${middle.toFixed(2)} R  tau ${region.tau.toFixed(3)} w ${region.albedo}  model ${(transmitted / reflected).toFixed(3)}` +
      `  pixels ${(unlitPixels / litPixels).toFixed(3)}   (lit ${litPixels.toExponential(2)}, unlit ${unlitPixels.toExponential(2)})`);
  }
}
