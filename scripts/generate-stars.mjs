import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const width = 4096, height = 2048;
const png = new PNG({ width, height });
let seed = 1787;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const hash = (x,y,z) => { let a = Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647); a = Math.imul(a^(a>>>13),1274126177); return ((a^(a>>>16))>>>0)/4294967295; };
function noise(x,y,z) {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  let fx=x-ix,fy=y-iy,fz=z-iz;
  fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy); fz=fz*fz*(3-2*fz);
  const mix=(a,b,t)=>a+(b-a)*t;
  return mix(mix(mix(hash(ix,iy,iz),hash(ix+1,iy,iz),fx),mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),fx),fy),mix(mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),fx),mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),fx),fy),fz);
}
for(let y=0;y<height;y++) {
  const latitude=(0.5-y/height)*Math.PI;
  for(let x=0;x<width;x++) {
    const longitude=(x/width-0.5)*Math.PI*2;
    const dx=Math.cos(latitude)*Math.cos(longitude),dy=Math.sin(latitude),dz=Math.cos(latitude)*Math.sin(longitude);
    const latitudeBand=dx*0.28+dy*0.83+dz*0.48;
    const n=noise(dx*7+8,dy*7+8,dz*7+8)*0.6+noise(dx*19+20,dy*19+20,dz*19+20)*0.3+noise(dx*51+55,dy*51+55,dz*51+55)*0.1;
    const band=Math.exp(-Math.pow(latitudeBand*5.5,2));
    const dust=1-0.8*Math.exp(-Math.pow((latitudeBand+0.055*(n-0.5))*29,2));
    const value=band*(2+30*Math.pow(n,2.2))*dust;
    const i=(y*width+x)*4;
    png.data[i]=2+value*0.79; png.data[i+1]=3+value*0.89; png.data[i+2]=5+value; png.data[i+3]=255;
  }
}
for(let s=0;s<22000;s++) {
  const x=random()*width,y=Math.acos(2*random()-1)/Math.PI*height;
  const bright=Math.pow(random(),7);
  const radius=0.45+bright*1.1;
  const energy=35+bright*215;
  const warm=random()>0.74;
  const color=warm?[1,0.80,0.62]:[0.77+random()*0.23,0.86+random()*0.14,1];
  const extent=Math.ceil(radius*3);
  for(let oy=-extent;oy<=extent;oy++) for(let ox=-extent;ox<=extent;ox++) {
    const py=Math.floor(y)+oy;
    if(py<0||py>=height) continue;
    const px=(Math.floor(x)+ox+width)%width;
    const d2=(Math.floor(x)+ox+0.5-x)**2+(py+0.5-y)**2;
    const v=energy*Math.exp(-d2/(radius*radius));
    const i=(py*width+px)*4;
    for(let c=0;c<3;c++) png.data[i+c]=Math.min(255,png.data[i+c]+v*color[c]);
  }
}
fs.mkdirSync(path.join(root,'public/shared'),{recursive:true});
fs.writeFileSync(path.join(root,'public/shared/starfield.png'),PNG.sync.write(png));
console.log('Generated deterministic 4096 x 2048 starfield. Seed: 1787.');
