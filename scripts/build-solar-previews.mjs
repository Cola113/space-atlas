import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {bodies} from '../solar-system/src/data.js';

const textures=new URL('../public/solar-system/textures/',import.meta.url);
const previews=new URL('previews/',textures),thumbnails=new URL('thumbnails/',textures);
await mkdir(previews,{recursive:true});await mkdir(thumbnails,{recursive:true});
const primary=new Set(['sun','mercury','venus','earth','mars','jupiter','saturn','uranus','neptune']);
const manifest={version:1,method:'Resize existing published assets with sharp; no new observed or generated detail',firstScreen:[],thumbnails:[]};
const hash=data=>createHash('sha256').update(data).digest('hex');
async function convert(source,destination,width,quality){
 const input=await readFile(new URL(source,textures));
 const {data,info}=await sharp(input).resize({width,withoutEnlargement:true}).webp({quality,effort:6}).toBuffer({resolveWithObject:true});
 await writeFile(destination,data);
 return {source,sourceSha256:hash(input),file:destination.pathname.split('/').slice(-2).join('/'),bytes:data.length,width:info.width,height:info.height,sha256:hash(data)};
}
for(const body of bodies){
 const source=body.baseTexture||`2k_${body.texture}.jpg`;
 manifest.thumbnails.push({id:body.id,...await convert(source,new URL(body.id+'.webp',thumbnails),192,65)});
 if(primary.has(body.id))manifest.firstScreen.push({id:body.id,key:source,...await convert(source,new URL(body.id+'.webp',previews),768,78)});
}
for(const [id,key,width] of [['earth-clouds','2k_earth_clouds.jpg',512],['saturn-ring','2k_saturn_ring_alpha.png',512]]){
 manifest.firstScreen.push({id,key,...await convert(key,new URL(id+'.webp',previews),width,80)});
}
const bytes=manifest.firstScreen.reduce((sum,item)=>sum+item.bytes,0);
if(bytes>1.5*1024*1024)throw new Error(`First-screen previews exceed 1.5 MiB: ${bytes}`);
manifest.firstScreenBytes=bytes;
await writeFile(new URL('manifest.json',previews),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({firstScreenTextures:manifest.firstScreen.length,firstScreenBytes:bytes,thumbnailCount:manifest.thumbnails.length}));
