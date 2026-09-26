// Independent verification path: scalar dot products and bisection, no renderer imports.
export const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
export const sub=(a,b)=>a.map((x,i)=>x-b[i]);
export const norm=a=>Math.hypot(...a);
export const unit=a=>a.map(x=>x/norm(a));
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function referenceShadow({sun,parent,moon,axes,orientation,moonRadius,sunRadius}) {
  const basis=[orientation.prime.toArray(),orientation.north.toArray(),orientation.east.toArray().map(x=>-x)];
  const relative=sub(moon,parent),ray=unit(sub(moon,sun)),distance=norm(sub(moon,sun));
  const o=basis.map(b=>dot(relative,b)),d=basis.map(b=>dot(ray,b));
  const evaluate=t=>o.reduce((v,x,i)=>v+((x+t*d[i])/axes[i])**2,-1);
  const minimum=-o.reduce((s,x,i)=>s+x*d[i]/axes[i]**2,0)/d.reduce((s,x,i)=>s+x*x/axes[i]**2,0);
  if(minimum<=0 || evaluate(minimum)>0)return null;
  let lo=0,hi=minimum;
  for(let i=0;i<90;i++){const mid=(lo+hi)/2;if(evaluate(mid)>0)lo=mid;else hi=mid;}
  const t=(lo+hi)/2,hit=o.map((x,i)=>x+t*d[i]);
  // At the shadow cross-section, solve equality of angular disk contacts.
  // This does not reuse the implementation's cone/tangent formula.
  function contact(outer){
    const f=r=>{
      const ma=Math.asin(moonRadius/Math.hypot(t,r)),sa=Math.asin(sunRadius/Math.hypot(distance+t,r));
      const separation=Math.atan2(r,t)-Math.atan2(r,distance+t);
      return ma+(outer?sa:-sa)-separation;
    };
    if(f(0)<=0)return 0;
    let left=0,right=moonRadius*2+t*sunRadius/distance*2;
    for(let i=0;i<80;i++){const mid=(left+right)/2;if(f(mid)>0)left=mid;else right=mid;}
    return (left+right)/2;
  }
  const umbra=contact(false),penumbra=contact(true);
  return {hitLocalKm:hit,center:hit.map(x=>x/axes[0]),distanceToSurfaceKm:t,
    umbraRadiusKm:umbra,penumbraRadiusKm:penumbra,diameterKm:umbra*2,
    axisLocal:d,incidence:-dot(unit(hit.map((x,i)=>x/axes[i]**2)),d)};
}
