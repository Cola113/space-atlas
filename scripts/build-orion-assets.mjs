import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const directory = new URL('../public/orion-nebula/', import.meta.url);
await mkdir(directory, { recursive: true });
const sourceUrl = 'https://cdn.esahubble.org/archives/images/publicationjpg/heic0601a.jpg';
const source = process.argv[2] ? await readFile(process.argv[2]) : await (async () => {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error('Source download failed: ' + response.status);
  return Buffer.from(await response.arrayBuffer());
})();
const metadata = await sharp(source).metadata();
if (metadata.width !== 4000 || metadata.height !== 4000) throw new Error('Unexpected source dimensions');
await sharp(source).resize(2048, 2048).webp({ quality: 92 }).toFile(fileURLToPath(new URL('observation.webp', directory)));
const rawOptions = { raw: { width: 1536, height: 1536, channels: 3 } };
const small = await sharp(source).resize(1536, 1536).removeAlpha().raw().toBuffer();
const diffuse = await sharp(small, rawOptions).median(5).raw().toBuffer();
// Replace compact stellar peaks locally; retain the surrounding cloud filaments.
const guide=Buffer.from(small),mask=new Uint8Array(1536*1536);
for(let y=3;y<1533;y++)for(let x=3;x<1533;x++){
 const i=(y*1536+x)*3;
 const excess=Math.max(small[i]-diffuse[i],small[i+1]-diffuse[i+1],small[i+2]-diffuse[i+2]);
 if(excess>27)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)mask[(y+dy)*1536+x+dx]=1;
}
for(let i=0;i<mask.length;i++)if(mask[i])for(let c=0;c<3;c++)guide[i*3+c]=diffuse[i*3+c];
await sharp(guide,rawOptions).webp({quality:96}).toFile(fileURLToPath(new URL('cloud-guide.webp',directory)));
await sharp(guide,rawOptions).resize(320,320).webp({quality:95}).toFile(fileURLToPath(new URL('density-guide.webp',directory)));
const stars = [];
for (let y = 4; y < 1532; y += 4) for (let x = 4; x < 1532; x += 4) {
  const i = (y * 1536 + x) * 3;
  const peak = Math.max(small[i], small[i+1], small[i+2]);
  const background = Math.max(diffuse[i], diffuse[i+1], diffuse[i+2]);
  if (peak - background > 28 && peak > 100) stars.push({ x: x/1536, y: y/1536, power: peak/255, color: [small[i]/255,small[i+1]/255,small[i+2]/255] });
}
await writeFile(new URL('stars.json', directory), JSON.stringify(stars));
await writeFile(new URL('source.json', directory), JSON.stringify({
 source: sourceUrl, page: 'https://esahubble.org/images/heic0601a/',
 license: 'CC BY 4.0', sourceSha256: createHash('sha256').update(source).digest('hex'),
 originalDimensions: [4000,4000], observationDimensions: [2048,2048], emissionDimensions: [1536,1536],
 generatedWithAI: false, starCandidates: stars.length,
 detailDimensions:[1024,1024], cloudGuideDimensions:[1536,1536],densityGuideDimensions:[320,320],
 modifications: 'Resizing, local stellar-peak replacement, median filtering, and stellar peak extraction. The observation guides cloud color, column density and authored cloud-wall depth. Surrounding gas, depth, internal geometry and added stellar distances are illustrative.',
}, null, 2));
console.log(JSON.stringify({stars: stars.length, sourceDimensions: [4000,4000]}));
await sharp(diffuse, rawOptions).webp({ quality: 94 }).toFile(fileURLToPath(new URL('emission.webp', directory)));
await sharp(fileURLToPath(new URL('emission.webp',directory))).resize(1024,1024).median(15).blur(1.1).webp({quality:90}).toFile(fileURLToPath(new URL('cloud-detail.webp',directory)));
