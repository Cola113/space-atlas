import test from 'node:test';
import assert from 'node:assert/strict';
import { Group,Mesh,Line,Vector3,Quaternion,PerspectiveCamera } from 'three';
import { bodies } from '../src/data.js';
import { updateDisplayState } from '../src/orbits.js';
import { skyRotation } from '../src/sky-coordinates.js';
import { localPhysics } from './physical-fixture.js';
import { RotationFollow,restoreFollowRotation } from '../src/camera-follow.js';
import { surfaceFrame,landingSites } from '../src/surface/geometry.js';

function scene(){return new Map(bodies.map(b=>{
  const root=new Group(),tilted=new Group(),mesh=new Mesh();root.add(tilted);tilted.add(mesh);
  return [b.id,{...b,root,tilted,mesh,orbitCenter:new Vector3(),orbitLine:new Line()}];
}));}

test('overview preserves physical latitude, eccentricity, orientation and Sun direction across display scales',async()=>{
  const provider=localPhysics(),objects=scene();
  // Every catalogue body must be present in the frame, so the dated systems are all
  // loaded here; Ceres joined that list when its Horizons bundle replaced the ellipse.
  await provider.ensure(new Date('2000-01-01'),['enceladus','miranda','pluto','ceres'],{prefetch:false});
  for(const stamp of ['2000-01-01','2000-03-21','2000-07-04','2000-12-21']){
    const frame=provider.frame(new Date(stamp)),rotation=skyRotation(frame.time.astronomy);
    updateDisplayState(objects,frame);
    assert.equal(frame.bodies.size,bodies.length);
    for(const body of objects.values()){
      assert.ok([...body.root.position,...body.displayOrientation].every(Number.isFinite),body.id);
      const expected=frame.bodies.get(body.id).orientation.prime.clone().applyMatrix3(rotation);
      const shown=new Vector3(1,0,0).applyQuaternion(body.displayOrientation);
      assert.ok(shown.distanceTo(expected)<1e-12,body.id);
      if(body.id==='sun')continue;
      const physical=frame.bodies.get(body.id);
      assert.ok(body.sunDirection.distanceTo(physical.positionKm.clone().negate().normalize().applyMatrix3(rotation))<1e-12,body.id);
      if(body.id==='pluto')continue; // its orbit scale and binary scale intentionally differ.
      const center=body.parent ? (physical.orbitFrame==='barycenter'?objects.get(body.parent).orbitCenter:objects.get(body.parent).root.position) : new Vector3();
      const shownPosition=body.root.position.clone().sub(center);
      assert.ok(shownPosition.normalize().distanceTo(physical.relativeKm.clone().normalize().applyMatrix3(rotation))<1e-9,body.id);
    }
    for(const site of Object.values(landingSites))assert.equal(surfaceFrame(site,new Date(stamp),provider).physical,frame);
    const earth=objects.get('earth'),old=earth.root.position.clone();earth.orbit*=1.7;
    updateDisplayState(objects,frame);assert.ok(earth.root.position.distanceTo(old.multiplyScalar(1.7))<1e-9);
    earth.orbit/=1.7;
  }
  provider.dispose();
});

test('missing required data hides bodies and never produces a placeholder physical orbit',()=>{
  const provider=localPhysics(),objects=scene();
  updateDisplayState(objects,provider.frame(new Date('1971-08-01')));
  for(const id of ['pluto','charon','nix','enceladus','titan','miranda']){
    assert.equal(objects.get(id).root.visible,false,id);
    assert.equal(objects.get(id).physicalAvailable,false,id);
  }
  provider.dispose();
});

test('camera follow keeps enable/disable/rebind views, follows subsequent attitude, and preserves dragged offsets',()=>{
  const follow=new RotationFollow(),camera=new PerspectiveCamera(),target=new Vector3();
  const body={id:'earth',physicalAvailable:true,root:new Group(),displayOrientation:new Quaternion()};
  camera.position.set(3,2,7);const original=camera.position.clone();
  follow.update(body,camera,target,true);assert.deepEqual(camera.position,original);
  body.displayOrientation.setFromAxisAngle(new Vector3(0,1,0),.3);
  follow.update(body,camera,target,true);
  assert.ok(camera.position.distanceTo(original.clone().applyQuaternion(body.displayOrientation))<1e-12);
  camera.position.set(-2,4,7);const dragged=camera.position.clone();
  body.displayOrientation.setFromAxisAngle(new Vector3(0,1,0),.5);
  follow.update(body,camera,target,true);
  assert.ok(camera.position.distanceTo(dragged.applyAxisAngle(new Vector3(0,1,0),.2))<1e-12);
  const held=camera.position.clone();follow.update(body,camera,target,false);
  body.displayOrientation.setFromAxisAngle(new Vector3(0,1,0),2);
  follow.update(body,camera,target,true);assert.deepEqual(camera.position,held);
  follow.update({...body,id:'jupiter'},camera,target,true);assert.deepEqual(camera.position,held);
  assert.equal(restoreFollowRotation({lockSpin:true,rotations:[['earth',9]]}),true);
  assert.equal(restoreFollowRotation({lockSpin:true,followRotation:false}),false);
  assert.equal(restoreFollowRotation({}),false);
});
