// How the screen's ring-to-globe brightness ratio compares with what the two models say.
//
// Both quantities in play are I/F: the globe's is albedo * mu0 for a Lambertian surface,
// and the ring's is the slab reflectance the solver produced, times the fraction of the
// pixel the slab covers. The globe's albedo is read from the very texture it renders with,
// at the longitude and latitude of each sampled pixel, because the visible hemisphere here
// is the bright equatorial zone whose albedo is well above the map's mean. The renderer
// maps scene radiance through ACES with an exposure, so the pixels are run back through
// that curve before being compared.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Quaternion, Vector3 } from 'three';
import { tableAngles } from '../saturn-ring-faces/helpers.mjs';

const tag = process.argv[2] || 'default2026';
const dir = new URL('./', import.meta.url);
const root = new URL('../../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL(`${tag}.json`, dir), 'utf8'));
const table = JSON.parse(readFileSync(new URL('solar-system/src/ring-scattering.json', root), 'utf8'));
const declared = JSON.parse(readFileSync(new URL('solar-system/src/ring-regions.json', root), 'utf8')).regions;
const angles = tableAngles();
const nearest = value => angles.reduce((best, a) => Math.abs(a - value) < Math.abs(best - value) ? a : best, angles[0]);
const G = -0.3;
const phase = cosAlpha => (1 - G * G) / (1 + G * G + 2 * G * cosAlpha) ** 1.5;

const ACESInput = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const ACESOutput = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m, v) => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const fitted = v => {
  const a = v.map(x => x * (x + 0.0245786) - 0.000090537);
  const b = v.map(x => x * (0.983729 * x + 0.432951) + 0.238081);
  return a.map((x, i) => x / b[i]);
};
const exposure = 1.12;
// With the renderer's tone mapping switched off (NO_TONE=1 shots) the screen value is the
// scene radiance itself and only the sRGB transfer sits in between.
const noTone = Boolean(process.env.NO_TONE);
const toScreen = noTone
  ? linear => linear[0]
  : linear => mul(ACESOutput, fitted(mul(ACESInput, linear.map(v => v * exposure))))[0];
const fromScreen = target => {
  let lo = 0, hi = 200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (toScreen([mid, mid, mid]) < target) lo = mid; else hi = mid;
  }
  return lo;
};
const srgbToLinear = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

// The globe's own map, in linear space.
const mapName = process.env.MAP || '8k_saturn.jpg';
const globeMap = await sharp(fileURLToPath(new URL(`public/solar-system/textures/${mapName}`, root))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const mapAlbedo = (u, v) => {
  const x = Math.min(globeMap.info.width - 1, Math.max(0, Math.round(u * globeMap.info.width)));
  const y = Math.min(globeMap.info.height - 1, Math.max(0, Math.round(v * globeMap.info.height)));
  const i = (y * globeMap.info.width + x) * globeMap.info.channels;
  const linear = process.env.MAP_LINEAR
    ? s => s / 255
    : s => { const value = s / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * linear(globeMap.data[i]) + 0.7152 * linear(globeMap.data[i + 1]) + 0.0722 * linear(globeMap.data[i + 2]);
};

const { data, info } = await sharp(fileURLToPath(new URL(`${tag}.png`, dir))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const radiance = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return fromScreen((srgbToLinear(data[i]) + srgbToLinear(data[i + 1]) + srgbToLinear(data[i + 2])) / 3);
};

const eye = new Vector3().fromArray(meta.camera), target = new Vector3().fromArray(meta.target);
const forward = target.clone().sub(eye).normalize();
const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
const up = new Vector3().crossVectors(right, forward).normalize();
const f = (900 / 2) / Math.tan(meta.fieldOfView * Math.PI / 360);
const sun = new Vector3().fromArray(meta.sun).normalize();
const attitude = new Quaternion().fromArray(meta.orientation);
const ringNormal = new Vector3(0, 1, 0).applyQuaternion(attitude).normalize();
const { x: cx, y: cy, radius, radiusPx } = meta.body;
const relative = eye.clone().sub(target);
const ray = (x, y) => forward.clone()
  .addScaledVector(right, (x + .5 - cx) / f)
  .addScaledVector(up, -(y + .5 - cy) / f).normalize();

// three's sphere maps u from atan2(z, -x) and v from the polar angle; the mesh's local
// frame reaches the world through the body's attitude.
function globeAt(x, y) {
  const direction = ray(x, y);
  const b = 2 * direction.dot(relative), c = relative.lengthSq() - radius * radius;
  const disc = b * b / 4 - c;
  if (disc < 0) return null;
  const hit = relative.clone().addScaledVector(direction, -b / 2 - Math.sqrt(disc));
  const local = hit.clone().normalize().applyQuaternion(attitude.clone().invert());
  const normal = local.clone().applyQuaternion(attitude);
  const u = ((Math.atan2(local.z, -local.x) / (2 * Math.PI)) % 1 + 1) % 1;
  const v = Math.acos(Math.min(1, Math.max(-1, local.y))) / Math.PI;
  return { mu0: normal.dot(sun), mu: normal.dot(direction.clone().negate()), albedo: mapAlbedo(u, v) };
}
function ringAt(x, y) {
  const direction = ray(x, y);
  const denom = direction.dot(ringNormal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = relative.clone().negate().dot(ringNormal) / denom;
  if (t <= 0) return null;
  const radial = relative.clone().addScaledVector(direction, t).length() / radius;
  if (radial < 1.2 || radial > 2.3) return null;
  const view = direction.clone().negate();
  return { radial, mu0: Math.abs(sun.dot(ringNormal)), mu: Math.abs(view.dot(ringNormal)),
    cosAlpha: sun.dot(view), facing: sun.dot(ringNormal) * view.dot(ringNormal) };
}
const regionAt = radial => {
  const km = radial * 60268;
  const index = declared.findIndex(([, inner, outer]) => inner <= km && km < outer);
  return table.systems.saturn.regions[index < 0 ? table.systems.saturn.regions.length - 1 : index];
};
const ringModel = ring => {
  const region = regionAt(ring.radial);
  const mu0 = nearest(ring.mu0), mu = nearest(ring.mu);
  const i = angles.indexOf(mu), j0 = angles.indexOf(mu0);
  const P = phase(ring.cosAlpha);
  const reflectance = ring.facing > 0
    ? mu0 / (mu + mu0) * ((region.x[i] * region.x[j0] - region.y[i] * region.y[j0])
      + 0.25 * region.albedo * (1 - Math.exp(-region.tau * (1 / mu + 1 / mu0))) * (P - 1))
    : mu0 / (mu - mu0) * ((region.x[i] * region.y[j0] - region.y[i] * region.x[j0])
      + 0.25 * region.albedo * (Math.exp(-region.tau / mu) - Math.exp(-region.tau / mu0)) * (P - 1));
  return { reflectance, alpha: 1 - Math.exp(-region.tau / mu) };
};

// Depth along the view for both candidates, so a pixel can be attributed to whichever
// surface is actually in front of the other.
const globeDepth = (x, y) => {
  const direction = ray(x, y);
  const b = 2 * direction.dot(relative), c = relative.lengthSq() - radius * radius;
  const disc = b * b / 4 - c;
  return disc < 0 ? null : -b / 2 - Math.sqrt(disc);
};
const ringDepth = (x, y) => {
  const direction = ray(x, y);
  const denom = direction.dot(ringNormal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = relative.clone().negate().dot(ringNormal) / denom;
  return t > 0 ? t : null;
};
const samples = { globe: [], litC: [], litB: [], litA: [], unlitC: [], unlitB: [], unlitA: [] };
for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
  const ringT = ringDepth(x, y), globeT = globeDepth(x, y);
  const ring = ringAt(x, y);
  // Any ring in front of the globe dims the pixel it covers, so such pixels are not a
  // measurement of the globe.
  const ringInFront = ring && ring.facing > 0 && ringT !== null && globeT !== null && ringT < globeT;
  const globe = globeAt(x, y);
  if (globe && globe.mu0 > .5 && globe.mu > .5 && !ringInFront) samples.globe.push({ x, y, ...globe });
  if (!ring) continue;
  if (globeT !== null && ringT !== null && ringT > globeT) continue;   // hidden behind the globe
  // Inside the globe's own disc the pixel is mostly globe seen through a thin slab, so it
  // is not a measurement of the ring either.
  if (Math.hypot(x + .5 - cx, y + .5 - cy) < radiusPx * 1.02) continue;
  const band = ring.radial < 1.5 ? 'C' : ring.radial < 1.95 ? 'B' : ring.radial > 2.03 ? 'A' : null;
  if (!band) continue;
  // Both faces are measured: which one the camera is on is the sign of the two cosines
  // from the ring normal, and the model answers with reflection or transmission.
  samples[(ring.facing > 0 ? 'lit' : 'unlit') + band].push({ x, y, ...ring });
}
const report = {};
for (const [name, list] of Object.entries(samples)) {
  if (list.length < 50) { report[name] = null; continue; }
  const step = Math.max(1, Math.floor(list.length / 3000));
  let measured = 0, reflectance = 0, albedo = 0, mu0 = 0, alpha = 0, count = 0;
  for (let i = 0; i < list.length; i += step) {
    const sample = list[i];
    const value = radiance(sample.x, sample.y);
    if (value < 1e-5) continue;
    measured += value;
    if (name === 'globe') {
      reflectance += sample.albedo * sample.mu0;
      albedo += sample.albedo; mu0 += sample.mu0;
    } else {
      const slab = ringModel(sample);
      reflectance += slab.reflectance;
      alpha += slab.alpha;
    }
    count++;
  }
  report[name] = { pixels: count, measured: measured / count, reflectance: reflectance / count,
    albedo: albedo / count, mu0: mu0 / count, alpha: alpha / count };
}
const elevation = Math.asin(sun.dot(ringNormal)) * 180 / Math.PI;
const phaseAngle = Math.acos(Math.min(1, Math.max(-1, sun.dot(forward.clone().negate())))) * 180 / Math.PI;
console.log(`${tag}: sun elevation ${elevation.toFixed(1)}°, phase angle ${phaseAngle.toFixed(1)}°, map ${mapName}`);
for (const [name, value] of Object.entries(report)) {
  if (!value) { console.log(`  ${name.padEnd(5)} not enough lit pixels`); continue; }
  const extra = name === 'globe'
    ? `  albedo ${value.albedo.toFixed(3)}  mu0 ${value.mu0.toFixed(3)}`
    : `  slab opacity ${value.alpha.toFixed(3)}`;
  console.log(`  ${name.padEnd(5)} pixels ${String(value.pixels).padStart(5)}  screen ${value.measured.toExponential(3)}` +
    `  model I/F ${value.reflectance.toExponential(3)}  screen/I-F ${(value.measured / value.reflectance).toFixed(3)}${extra}`);
}
for (const band of ['B', 'A', 'C']) {
  const lit = report[`lit${band}`], unlit = report[`unlit${band}`];
  if (!lit || !unlit) { console.log(`  ${band} ring: one face is not visible in this framing`); continue; }
  const screen = unlit.measured / lit.measured, physical = unlit.reflectance / lit.reflectance;
  console.log(`  ${band} ring unlit/lit: on screen ${(100 * screen).toFixed(1)}%, model says ${(100 * physical).toFixed(1)}%` +
    ` -> the dark face carries ${(screen / physical).toFixed(2)}x its physical share`);
}
if (report.globe && report.litB) {
  const screen = report.litB.measured / report.globe.measured;
  const physical = report.litB.reflectance / report.globe.reflectance;
  console.log(`\nB ring against the globe: on screen ${screen.toFixed(3)}, models say ${physical.toFixed(3)}` +
    ` -> the ring shows ${(screen / physical).toFixed(2)}x its physical share`);
}
