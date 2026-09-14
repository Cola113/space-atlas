import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const dir = new URL('./viewpoints/', import.meta.url);
const load = async name => {
  const { data, info } = await sharp(fileURLToPath(new URL(`${name}.png`, dir))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info, at: (x, y) => { const i = (y * info.width + x) * info.channels; return (data[i] + data[i + 1] + data[i + 2]) / 3; } };
};
// Equinox: the ring is edge-on, so it crosses the globe as a dark line. Sample the line
// crossing the limb on the left and compare with the globe just above and below it.
{
  const image = await load('2025-equinox-edge');
  const column = 680;
  const column_values = [];
  for (let y = 360; y <= 500; y++) column_values.push(image.at(column, y));
  const sorted = [...column_values].sort((a, b) => a - b);
  console.log(`equinox: column ${column} min ${sorted[0].toFixed(1)} median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} max ${sorted.at(-1).toFixed(1)}`);
  console.log(`  darkest-10 mean ${(sorted.slice(0, 10).reduce((a, b) => a + b, 0) / 10).toFixed(1)}, globe mean ${(column_values.reduce((a, b) => a + b, 0) / column_values.length).toFixed(1)}`);
}
// Solstice: the ring is open, so the band above the globe is ring light on black sky.
for (const name of ['2002-solstice-north', '2017-solstice-south']) {
  const image = await load(name);
  let ringSum = 0, ringCount = 0, skySum = 0, skyCount = 0;
  for (let y = 180; y < 320; y++) for (let x = 350; x < 620; x++) {
    const value = image.at(x, y);
    if (value > 12) { ringSum += value; ringCount++; } else { skySum += value; skyCount++; }
  }
  console.log(`${name}: open ring band mean ${(ringSum / Math.max(ringCount, 1)).toFixed(1)} over ${ringCount} px, sky mean ${(skySum / Math.max(skyCount, 1)).toFixed(1)}`);
}
