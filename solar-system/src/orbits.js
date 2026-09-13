import { Vector3, Matrix4, Quaternion } from 'three';
import { MassProduct } from 'astronomy-engine';
import { skyRotation } from './sky-coordinates.js';
import { physicalData } from './physical-scale.js';
import { AU_KM, physicalNames } from './physics/state.js';
import { orbitalElements } from './physics/kepler.js';
import anchors from './physics/kepler-anchors.json';

// Display scales never feed back into the evaluated physical frame.
const gmSun = MassProduct('Sun') * AU_KM ** 3 / 86400 ** 2;
function scaleFor(body) {
  const definition = physicalData[body.id];
  return body.orbit / (definition.orbitKm || definition.orbitAU * AU_KM);
}
export function updateDisplayState(objects, frame, {guides = true} = {}) {
  const rotation = skyRotation(frame.time.astronomy);
  const barycenter = frame.barycenters.get('pluto');
  const pluto = objects.get('pluto'), charon = objects.get('charon');
  const binaryScale = charon ? scaleFor(charon) : 1;
  const displayedBarycenter = barycenter && pluto ? barycenter.clone().applyMatrix3(rotation).multiplyScalar(scaleFor(pluto)) : null;
  for (const body of objects.values()) {
    const physical = frame.bodies.get(body.id);
    body.physicalAvailable = Boolean(physical);
    if (!physical) { body.root.visible = false; if(body.orbitLine)body.orbitLine.visible=false; continue; }
    body.physical = physical;
    const parent = objects.get(physical.parent);
    if (body.id === 'sun') body.root.position.set(0,0,0);
    else if (body.id === 'pluto' && displayedBarycenter) {
      body.root.position.copy(physical.positionKm).sub(barycenter).applyMatrix3(rotation).multiplyScalar(binaryScale).add(displayedBarycenter);
    } else if (body.parent && parent) {
      const center = physical.orbitFrame === 'barycenter' ? parent.orbitCenter : parent.root.position;
      body.root.position.copy(physical.relativeKm).applyMatrix3(rotation).multiplyScalar(scaleFor(body)).add(center);
    } else body.root.position.copy(physical.positionKm).applyMatrix3(rotation).multiplyScalar(scaleFor(body));
    body.orbitCenter.copy(body.id === 'pluto' && displayedBarycenter ? displayedBarycenter : body.root.position);
    const north=physical.orientation.north.clone().applyMatrix3(rotation);
    const prime=physical.orientation.prime.clone().applyMatrix3(rotation);
    const minusEast=physical.orientation.east.clone().applyMatrix3(rotation).negate();
    // Three sphere axes: +X zero longitude, +Y north, -Z east. The pole parent
    // stays unspun so rings do not inherit the prime-meridian rotation.
    const node=new Vector3(0,1,0).cross(north).normalize();
    if(node.lengthSq()<.5)node.set(1,0,0);
    body.tilted.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(node,north,node.clone().cross(north)));
    const attitude=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(prime,north,minusEast));
    body.mesh.quaternion.copy(body.tilted.quaternion).invert().multiply(attitude);
    body.displayOrientation ??= new Quaternion(); body.displayOrientation.copy(attitude);
    if(body.clouds)body.clouds.quaternion.copy(body.mesh.quaternion);
    body.sunDirection ??= new Vector3();
    body.sunDirection.copy(physical.positionKm).negate().normalize().applyMatrix3(rotation);
    body.sunAngularRadius = body.id === 'sun' ? 0 : Math.asin(physicalData.sun.radiusKm / physical.positionKm.length());
    if(guides && body.orbit && body.orbitLine) updateGuide(body, parent, physical, frame, rotation);
  }
  return frame;
}
function updateGuide(body, parent, physical, frame, rotation) {
  const line=body.orbitLine;
  const center=body.parent ? (physical.orbitFrame==='barycenter'?parent.orbitCenter:parent.root.position) : new Vector3();
  line.position.copy(center);line.quaternion.identity();line.scale.setScalar(1);
  // Instantaneous osculating ellipse: a guide, not a future ephemeris.
  const r=body.id==='pluto'?frame.barycenters.get('pluto'):physical.relativeKm;
  const v=body.id==='pluto'?frame.barycenterVelocities.get('pluto'):physical.relativeVelocityKmS;
  const period = Math.PI*2*r.length()/Math.max(1e-10,v.length());
  const age = Math.abs(frame.time.tdbSeconds-(body.guideEpoch ?? -Infinity));
  if(age < Math.min(86400,period/128) && body.guideScale===body.orbit)return;
  let elements;
  if(physical.orbitGuide) {
    elements=physical.orbitGuide;
  } else {
    const gm=anchors.anchors.first.elements[body.id]?.gmKm3S2 ?? (body.parent
      ? MassProduct(physicalNames[body.parent]) * AU_KM**3/86400**2 + (body.id==='moon'?MassProduct('Moon')*AU_KM**3/86400**2:0)
      : gmSun);
    elements=orbitalElements(r.toArray(),v.toArray(),gm,frame.time.tdbSeconds);
  }
  const p=new Vector3().fromArray(elements.p),q=new Vector3().fromArray(elements.q);
  const points=Array.from({length:256},(_,i)=>{
    const e=i/256*Math.PI*2;
    return p.clone().multiplyScalar(elements.aKm*(Math.cos(e)-elements.e))
      .addScaledVector(q,elements.aKm*Math.sqrt(1-elements.e**2)*Math.sin(e)).applyMatrix3(rotation).multiplyScalar(scaleFor(body));
  });
  line.geometry.setFromPoints(points);line.geometry.computeBoundingSphere();body.guideEpoch=frame.time.tdbSeconds;body.guideScale=body.orbit;
}
