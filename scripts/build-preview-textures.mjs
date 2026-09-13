import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {bodies} from '../solar-system/src/data.js';
const root='public/solar-system/textures';
await mkdir(`${root}/preview`,{recursive:true});await mkdir(`${root}/thumbs`,{recursive:true});
const names=[...new Set([...bodies.map(b=>b.baseTexture||`2k_${b.texture}.jpg`),'2k_earth_clouds.jpg','2k_saturn_ring_alpha.png'])];
const manifest={version:1,method:'Resized copies of existing source textures; no new image detail',files:{}};
for(const name of names){
 const output=name.replaceAll('/','_')+'.webp';
 const data=await sharp(`${root}/${name}`).resize({width:1024,withoutEnlargement:true}).webp({quality:72,alphaQuality:90}).toBuffer();
 await writeFile(`${root}/preview/${output}`,data);
 await sharp(`${root}/${name}`).resize({width:96}).webp({quality:65}).toFile(`${root}/thumbs/${output}`);
 manifest.files[name]={preview:`preview/${output}`,thumbnail:`thumbs/${output}`,bytes:data.length};
}
await writeFile(`${root}/preview/manifest.json`,JSON.stringify(manifest,null,2));
console.log(`Generated ${names.length} preview textures`);
