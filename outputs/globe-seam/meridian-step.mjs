// Trace the seam meridian on screen and measure the brightness step across it.
//
// The seam is the great circle through the mesh's local +-Y poles and its local -X axis,
// i.e. every surface point with a local z of zero and a local x below zero. For each
// screen row the script solves the ray-sphere intersection, converts the hit to the mesh's
// own frame and takes the pixel that lands on that circle, then compares the brightness
// two pixels to either side of it. Comparing the two builds' numbers isolates the seam
// from the planet's own cloud gradient, which is the same in both.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { Quaternion, Vector3 } from 'three';
const file = process.argv[2];
const { state, body } = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const attitude = new Quaternion().fromArray(body.orientation);
const eye = new Vector3().fromArray(state.camera), target = new Vector3().fromArray(state.target);
const forward = target.clone().sub(eye).normalize();
const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
const up = new Vector3().crossVectors(right, forward).normalize();
const depth = eye.distanceTo(target);
const f = (900 / 2) / Math.tan(state.fieldOfView * Math.PI / 360);
const radius = body.radius;
const origin = target.clone();          // the globe is centred on the camera's target
const relative = eye.clone().sub(origin);
const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const lum = (x, y) => { const i = (y * info.width + x) * info.channels; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
const localOf = (x, y) => {
  const direction = forward.clone()
    .addScaledVector(right, (x + .5 - body.x) / f)
    .addScaledVector(up, -(y + .5 - body.y) / f).normalize();
  const b = 2 * direction.dot(relative), c = relative.lengthSq() - radius * radius;
  const disc = b * b / 4 - c;
  if (disc < 0) return null;
  const t = -b / 2 - Math.sqrt(disc);
  return relative.clone().addScaledVector(direction, t).normalize().applyQuaternion(attitude.clone().invert());
};
let sum = 0, count = 0, worst = 0;
for (let y = Math.round(body.y - body.radiusPx * .8); y < Math.round(body.y + body.radiusPx * .8); y++) {
  let seamX = null;
  for (let x = Math.round(body.x - body.radiusPx); x <= Math.round(body.x + body.radiusPx); x++) {
    const local = localOf(x, y);
    if (!local || local.x > -0.02 || Math.abs(local.z) > 0.02) continue;
    seamX = x; break;
  }
  if (seamX === null) continue;
  const a = lum(seamX - 2, y), b = lum(seamX + 2, y);
  if (Math.min(a, b) < 30) continue;
  const step = Math.abs(a - b);
  sum += step; count++;
  if (step > worst) worst = step;
}
console.log(`${file}: seam meridian rows ${count}, mean step ${count ? (sum / count).toFixed(2) : '--'}/255, worst ${worst.toFixed(1)}`);
