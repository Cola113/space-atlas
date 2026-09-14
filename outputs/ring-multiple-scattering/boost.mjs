import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
// Extreme contrast boost, to see whether a very dark ring system is drawn at all.
for (const name of ['saturn', 'uranus', 'neptune', 'jupiter']) {
  const file = fileURLToPath(new URL(`./ring-systems/${name}.png`, import.meta.url));
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let max = 0, lit = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const value = Math.max(data[i], data[i + 1], data[i + 2]);
    if (value > max) max = value;
    if (value > 2) lit++;
  }
  await sharp(file).removeAlpha().linear(48, 4).png().toFile(fileURLToPath(new URL(`./ring-systems/${name}-boost.png`, import.meta.url)));
  console.log(`${name}: max channel ${max}, pixels above 2: ${lit}`);
}
