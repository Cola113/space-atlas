// Measure the planet's shadow on the ring plane in the face-on framing, in units the
// geometry fixes independently of any frame reconstruction: the planet's own projected
// radius is the ruler.
//
// With the sun at elevation e above the ring plane, the planet's shadow on that plane is
// the region {p : the ray from p towards the sun passes within the planet}. Scaling the
// polar axis by 1/ratio turns the spheroid into a unit sphere, so with u the sun's
// in-plane direction and n perpendicular to it, the shadow is
//      a^2 (1 - cos^2 e / |s'|^2) + b^2 < 1,  |s'|^2 = cos^2 e + sin^2 e / ratio^2
// i.e. a tongue of half-width exactly 1 equatorial radius across, reaching
// 1/sqrt(1 - cos^2 e/|s'|^2) radii along the anti-sunward axis, and only that half of it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Quaternion, Vector3, Matrix4 } from 'three';

const dir = new URL('./', import.meta.url);
const records = JSON.parse(readFileSync(new URL('faceon.json', dir), 'utf8'));

for (const entry of records) {
  const body = entry.on.body, state = entry.on.state;
  const attitude = new Quaternion().fromArray(body.orientation);
  const north = new Vector3(0, 1, 0).applyQuaternion(attitude).normalize();
  const sun = new Vector3().fromArray(body.sunDirection);
  const sinElevation = sun.dot(north);
  const cosElevation = Math.sqrt(1 - sinElevation ** 2);
  const ratio = 0.902;
  const lightLength = Math.sqrt(cosElevation ** 2 + sinElevation ** 2 / ratio ** 2);
  const reach = 1 / Math.sqrt(1 - cosElevation ** 2 / lightLength ** 2);

  const on = await sharp(fileURLToPath(new URL(`faceon-${entry.date}-on.png`, dir))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const off = await sharp(fileURLToPath(new URL(`faceon-${entry.date}-off.png`, dir))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = on.info;
  const lum = (b, i) => (b[i] + b[i + 1] + b[i + 2]) / 3 / 255;

  // Which screen direction is anti-sunward? In this framing the camera looks down the
  // polar axis, so the sun's in-plane part projects straight onto the screen: project it.
  const eye = new Vector3().fromArray(state.camera), target = new Vector3().fromArray(state.target);
  const forward = target.clone().sub(eye).normalize();
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const inPlane = sun.clone().addScaledVector(north, -sinElevation).normalize();
  const axis = { x: inPlane.dot(right), y: -inPlane.dot(up) };   // screen axes, y down

  // Darkening profile: distance from the shadow axis, split by side along it.
  const bins = 41, half = (bins - 1) / 2;
  const across = new Float64Array(bins), along = new Float64Array(bins), acrossN = new Float64Array(bins), alongN = new Float64Array(bins);
  let changed = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + .5 - body.x, dy = y + .5 - body.y;
    const r = Math.hypot(dx, dy) / body.radiusPx;
    if (r < 1.1 || r > 2.2) continue;
    const i = (y * width + x) * channels;
    const lit = lum(off.data, i);
    if (lit < 0.01) continue;            // ring not drawn here (a gap, or outside)
    const drop = (lit - lum(on.data, i)) / lit;
    if (drop > 0.1) changed++;
    // Project onto the shadow axis and its perpendicular, in planet radii.
    const a = (dx * axis.x + dy * axis.y) / body.radiusPx;
    const b = (-dx * axis.y + dy * axis.x) / body.radiusPx;
    if (Math.abs(b) > 1.05) continue;
    const k = Math.round(a + half);
    if (k < 0 || k >= bins) continue;
    along[k] += drop; alongN[k]++;
    const j = Math.round(b * 20 + 20);
    if (j >= 0 && j < bins && a < 0) { across[j] += drop; acrossN[j]++; }
  }
  const report = [];
  for (let k = 0; k < bins; k++) if (alongN[k] > 200)
    report.push(`${(k - half).toFixed(1)}R:${(along[k] / alongN[k]).toFixed(2)}`);
  console.log(`${entry.iso}  sun elevation ${(Math.asin(sinElevation) * 180 / Math.PI).toFixed(1)} degrees`);
  console.log(`  predicted shadow: half-width 1.00 R across, reach ${reach.toFixed(2)} R anti-sunward`);
  console.log(`  darkened fraction along the shadow axis (negative = anti-sunward):`);
  console.log('   ' + report.join(' '));
  const acrossReport = [];
  for (let j = 0; j < bins; j++) if (acrossN[j] > 200)
    acrossReport.push(`${((j - 20) / 20).toFixed(2)}R:${(across[j] / acrossN[j]).toFixed(2)}`);
  console.log(`  darkened fraction across the axis, anti-sunward half only:`);
  console.log('   ' + acrossReport.join(' '));
  console.log(`  pixels darkened by more than 10%: ${changed}`);
}
