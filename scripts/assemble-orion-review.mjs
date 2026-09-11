import sharp from 'sharp';
import {copyFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,sep} from 'node:path';
const source=new URL('../test-results/orion-cruise/',import.meta.url);
const out=process.env.ORION_REVIEW_DIR?pathToFileURL(resolve(process.env.ORION_REVIEW_DIR)+sep):new URL('../test-results/orion-cruise-review/',import.meta.url);
await mkdir(out,{recursive:true});
const views=[['shot-0','01 正面'],['shot-2','02 核心'],['shot-5','03 云壁'],['shot-7','04 全景回望']];
const layers=[];
for(let i=0;i<views.length;i++){
 const [view,label]=views[i],x=i%2*960,y=Math.floor(i/2)*646;
 await copyFile(new URL('1440-'+view+'.png',source),new URL(view+'.png',out));
 await copyFile(new URL('390-'+view+'.png',source),new URL('mobile-'+view+'.png',out));
 const image=await sharp(fileURLToPath(new URL(view+'.png',out))).resize(960,600).png().toBuffer();
 const title=Buffer.from('<svg width="960" height="46" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="46" fill="#111a1b"/><text x="20" y="30" fill="#e4efee" font-family="Microsoft YaHei" font-size="22">'+label+'</text></svg>');
 layers.push({input:title,left:x,top:y},{input:image,left:x,top:y+46});
}
await sharp({create:{width:1920,height:1292,channels:3,background:'#080d0e'}}).composite(layers).jpeg({quality:94}).toFile(fileURLToPath(new URL('four-views.jpg',out)));
const cards=views.map(([view,label])=>'<figure><figcaption>'+label+'</figcaption><a href="'+view+'.png"><img src="'+view+'.png" alt="'+label+'"></a><a class="mobile" href="mobile-'+view+'.png">手机截图</a></figure>').join('');
await writeFile(new URL('index.html',out),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>猎户座星云 · 四视角</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#080d0e;color:#e4efee;font:15px/1.6 system-ui}h1{font-size:24px;font-weight:500;margin:0 0 16px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{margin-bottom:8px}a{color:#abd9cb}.mobile{display:inline-block;margin-top:6px}@media(max-width:700px){body{padding:16px}main{grid-template-columns:1fr}}</style><h1>猎户座星云 · 四视角</h1><main>'+cards+'</main></html>');
console.log(fileURLToPath(new URL('four-views.jpg',out)));
