// Mean ring brightness by radial band, for each face. The bands are the ring's own
// structure: C ring, B ring, Cassini division and A ring.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const dir = new URL('./', import.meta.url);
const records = JSON.parse(readFileSync(new URL('faces.json', dir), 'utf8'));
const bands = [['C ring', 1.24, 1.52], ['B ring', 1.52, 1.95], ['Cassini', 1.95, 2.03], ['A ring', 2.03, 2.27]];
for (const record of records) {
  const { data, info } = await sharp(fileURLToPath(new URL(`face-${record.date}-${record.pole}-noshadow.png`, dir))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = i => (data[i] + data[i + 1] + data[i + 2]) / 3 / 255;
  const sums = bands.map(() => [0, 0]);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const r = Math.hypot(x + .5 - record.x, y + .5 - record.y) / record.radiusPx;
    bands.forEach(([, inner, outer], band) => {
      if (r < inner || r > outer) return;
      sums[band][0] += lum((y * info.width + x) * info.channels);
      sums[band][1]++;
    });
  }
  console.log(`${record.iso} ${record.pole.padEnd(5)} ${record.lit ? 'lit  ' : 'unlit'}  sun ${String(record.sunElevation).padStart(6)} deg  ` +
    bands.map(([name], band) => `${name} ${sums[band][1] ? (sums[band][0] / sums[band][1]).toFixed(4) : '--'}`).join('  '));
}
