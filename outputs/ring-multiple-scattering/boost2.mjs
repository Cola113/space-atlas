import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
for (const name of ['uranus', 'neptune', 'jupiter']) {
  const file = fileURLToPath(new URL(`./ring-systems/${name}-close.png`, import.meta.url));
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Row through the ring plane: the ring shows as a bright band either side of the globe.
  const row = Math.round(info.height * 0.5);
  const samples = [];
  for (let x = 0; x < info.width; x += 8) {
    const i = (row * info.width + x) * info.channels;
    samples.push(Math.max(data[i], data[i + 1], data[i + 2]));
  }
  const lit = samples.filter(v => v > 3).length;
  await sharp(file).removeAlpha().linear(24, 2).png().toFile(fileURLToPath(new URL(`./ring-systems/${name}-close-boost.png`, import.meta.url)));
  console.log(`${name}: max ${Math.max(...samples)} lit ${lit}/${samples.length}`);
}
