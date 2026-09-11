// The reference constrains the front projection. Depth and surrounding clouds are illustrative.
export const EXTENT = [32, 24, 26] as const;
export const FIELD_SIZE = [160, 128, 144] as const;
export interface ImageGuide { width:number;height:number;data:Uint8ClampedArray }
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
function hash(x:number,y:number,z:number){let h=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,2147483647);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;}
function noise(x:number,y:number,z:number){
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
 const fx=x-ix,fy=y-iy,fz=z-iz,a=fx*fx*(3-2*fx),b=fy*fy*(3-2*fy),c=fz*fz*(3-2*fz);
 const mix=(x:number,y:number,t:number)=>x+(y-x)*t;
 return mix(mix(mix(hash(ix,iy,iz),hash(ix+1,iy,iz),a),mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),a),b),mix(mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),a),mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),a),b),c);
}
function blob(x:number,y:number,z:number,cx:number,cy:number,cz:number,rx:number,ry:number,rz:number){return Math.exp(-2*((x-cx)**2/rx**2+(y-cy)**2/ry**2+(z-cz)**2/rz**2));}
export function guideLuminance(guide:ImageGuide|undefined,u:number,v:number){
 if(!guide)return .4;
 const x=clamp(u)*(guide.width-1),y=clamp(1-v)*(guide.height-1),ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const l=(x:number,y:number)=>{const i=(Math.min(y,guide.height-1)*guide.width+Math.min(x,guide.width-1))*4;return (guide.data[i]*.2126+guide.data[i+1]*.7152+guide.data[i+2]*.0722)/255;};
 return (l(ix,iy)*(1-fx)+l(ix+1,iy)*fx)*(1-fy)+(l(ix,iy+1)*(1-fx)+l(ix+1,iy+1)*fx)*fy;
}
export function referenceUv(x:number,y:number,z:number):[number,number]{const scale=32*(1-z/44);return [x/scale+.5,y/scale+.5];}
export function wallDepth(u:number,v:number){
 const cavity=Math.exp(-(((u-.445)/.23)**2+((v-.55)/.23)**2));
 const knot=Math.exp(-(((u-.315)/.09)**2+((v-.79)/.11)**2));
 return -9+13*(1-cavity)-2.4*Math.sin(u*8+v*5)+knot*3;
}
export function sampleField(x:number,y:number,z:number,guide?:ImageGuide):[number,number,number,number]{
 const edge=(1-smooth(29,32,Math.abs(x)))*(1-smooth(21,24,Math.abs(y)))*(1-smooth(23,26,Math.abs(z)));
 if(edge===0)return [0,0,0,0];
 const [u,v]=referenceUv(x,y,z);
 const imageEdge=smooth(0,.12,Math.min(u,v,1-u,1-v));
 const radial=1-smooth(.48,.72,Math.hypot((u-.5)*.93,v-.5));
 const lum=guideLuminance(guide,u,v);
 const n=noise(x*.23+19,y*.23+8,z*.23+4),fine=noise(x*.8,y*.8+9,z*.8)*.65+noise(x*1.9+4,y*1.9,z*1.9)*.35;
 const ridge=wallDepth(u,v);
 const width=1.4+1.5*(1-Math.exp(-(((u-.445)/.25)**2+((v-.55)/.25)**2)));
 const d=(z-ridge)/width;
 const profile=Math.exp(-d*d*.75)/width+.32*Math.exp(-(((z-ridge+5)/(width*1.15))**2))/(width*1.15);
 const primary=profile*(.12+lum*2.5)*imageEdge*radial*(.78+fine*.44);
 const dust=primary*(1-smooth(.11,.33,lum))*.45;
 // Offset branches and a loose foreground veil connect the subject to the surrounding region.
 const veinX=-16+y*.35+Math.sin(y*.23)*2;
 const filament=Math.exp(-(((x-veinX)/3.6)**2+((z-(5+y*.4))/4.5)**2))*Math.exp(-((y/21)**4));
 let surroundings=filament*.09;
 surroundings+=blob(x,y,z,19,-8,-7,12,6,8)*.14;
 surroundings+=blob(x,y,z,-19,10,-11,10,7,7)*.12;
 surroundings+=blob(x,y,z,10,16,-12,12,6,7)*.08;
 surroundings+=blob(x,y,z,-8,-13,11,16,3.7,5)*.052;
 surroundings+=blob(x,y,z,18,8,12,10,7,5)*.045;
 surroundings+=blob(x,y,z,0,0,-18,23,17,6)*.02;
 surroundings*=Math.max(.01,(n*.55+fine*.45-.3)*2.7)**2;
 const gas=(primary+surroundings)*edge;
 return [gas,(dust+surroundings*.32)*edge,primary/Math.max(primary+surroundings,.00001),lum];
}
export function buildField(guide?:ImageGuide){
 const [nx,ny,nz]=FIELD_SIZE,data=new Uint8Array(nx*ny*nz*4);let i=0;
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const s=sampleField((x/(nx-1)*2-1)*EXTENT[0],(y/(ny-1)*2-1)*EXTENT[1],(z/(nz-1)*2-1)*EXTENT[2],guide);
  data[i++]=Math.round(clamp(s[0])*255);data[i++]=Math.round(clamp(s[1])*255);data[i++]=Math.round(s[2]*255);data[i++]=Math.round(s[3]*255);
 }
 return data;
}
