import { AstroTime } from 'astronomy-engine';
export const coverage=[1900,2100];
const years=new Map(),pending=new Map();
export function tdbSeconds(date){
 const tt=new AstroTime(date).tt,g=(357.53+.9856003*tt)*Math.PI/180;
 return tt*86400+.001657*Math.sin(g)+.000022*Math.sin(2*g);
}
export function dataYear(date){return Math.max(1900,Math.min(2099,date.getUTCFullYear()));}
export function hasEphemeris(date){return years.has(dataYear(date));}
export function installEphemeris(meta,buffer){
 if(meta.version!==1||meta.stride!==41||meta.degree!==12||buffer.byteLength%328)throw new Error('星历数据格式无效');
 const coefficients=new Float64Array(buffer);
 if(!coefficients.every(Number.isFinite))throw new Error('星历数据损坏');
 for(const section of Object.values(meta.bodies))if(section.offset<0||section.count<1||(section.offset+section.count)*41>coefficients.length)throw new Error('星历索引无效');
 years.set(meta.year,{meta,coefficients});
 while(years.size>3)years.delete(years.keys().next().value);
}
export async function ensureEphemeris(date,{prefetch=true}={}){
 const year=dataYear(date);
 if(!years.has(year)){
  if(!pending.has(year))pending.set(year,(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{
    const [mr,br]=await Promise.all([fetch(`/solar-system/ephemeris/${year}.json`,{signal:controller.signal}),fetch(`/solar-system/ephemeris/${year}.bin`,{signal:controller.signal})]);
    if(!mr.ok||!br.ok)throw new Error('星历尚未加载，请重试');
    const [meta,buffer]=await Promise.all([mr.json(),br.arrayBuffer()]);
    if(globalThis.crypto?.subtle){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==meta.sha256)throw new Error('星历校验失败');}
    installEphemeris(meta,buffer);
   }finally{clearTimeout(timer);pending.delete(year);}
  })());
  await pending.get(year);
 }
 if(prefetch)for(const next of [year-1,year+1])if(next>=1900&&next<2100&&!years.has(next))void ensureEphemeris(new Date(Date.UTC(next,6,1)),{prefetch:false}).catch(()=>{});
}
export function polynomial(coefficients,offset,x){let b1=0,b2=0;for(let k=12;k>=1;k--){const b=2*x*b1-b2+coefficients[offset+k];b2=b1;b1=b;}return x*b1-b2+coefficients[offset];}
export function localPosition(name,date,et=tdbSeconds(date)){
 const entry=years.get(dataYear(date));if(!entry)throw new Error('需要加载当前年份星历');
 const section=entry.meta.bodies[name];if(!section)return null;
 const c=entry.coefficients;let lo=section.offset,hi=lo+section.count-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(et>c[mid*41+1])lo=mid+1;else hi=mid;}
 const offset=lo*41,start=c[offset],end=c[offset+1];
 const bounded=Math.max(start,Math.min(end,et));
 const at=t=>[0,1,2].map(axis=>polynomial(c,offset+2+axis*13,2*(t-start)/(end-start)-1));
 const position=at(bounded);
 if(et===bounded)return {position,approximate:false};
 // Osculating two-body extrapolation outside the published range, never high-precision.
 const delta=.5,ta=Math.max(start,bounded-delta),tb=Math.min(end,bounded+delta),a=at(ta),b=at(tb);
 const velocity=a.map((v,i)=>(b[i]-v)/(tb-ta));
 return {position:kepler(position,velocity,et-bounded,{Enceladus:37931207.8,Titan:37931207.8,Miranda:5793951.3,Charon:975.5,Pluto:132712440018}[name]),approximate:true};
}
function kepler(r,v,t,mu){
 const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],scale=(a,x)=>a.map(v=>v*x);
 const radius=Math.hypot(...r),h=cross(r,v),hv=cross(v,h),evec=hv.map((x,i)=>x/mu-r[i]/radius),e=Math.hypot(...evec),axis=1/(2/radius-dot(v,v)/mu);
 if(!(axis>0&&e<1))return r;
 const p=e>1e-8?scale(evec,1/e):scale(r,1/radius),normal=scale(h,1/Math.hypot(...h)),q=cross(normal,p);
 const e0=Math.atan2(dot(r,q)/(axis*Math.sqrt(1-e*e)),dot(r,p)/axis+e);
 const mean=(e0-e*Math.sin(e0)+Math.sqrt(mu/axis**3)*t)%(2*Math.PI);let eccentric=mean;
 for(let i=0;i<12;i++)eccentric-=(eccentric-e*Math.sin(eccentric)-mean)/(1-e*Math.cos(eccentric));
 return p.map((x,i)=>axis*((Math.cos(eccentric)-e)*x+Math.sqrt(1-e*e)*Math.sin(eccentric)*q[i]));
}
