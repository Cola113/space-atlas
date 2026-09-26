import * as THREE from 'three';
import { MOON_TRANSIT_SYSTEMS, physicalAxes, ellipsoidRayDistance } from './moon-transits.js';
import { skyRotation } from './sky-coordinates.js';
import { bindPhysicalSun } from './physical-lighting.js';

// The overview has no physical observer distance. Use the current bearing as a
// distant observer and retain true orthographic size/offset ratios to the parent.
// Perspective compensation below is a display transform, not an orbital state.
export function observerTransit(relativeKm, towardObserver, axes, moonRadiusKm) {
  const along=relativeKm.dot(towardObserver);
  if(along<=0)return null;
  const plane=relativeKm.clone().addScaledVector(towardObserver,-along);
  const expanded=axes.map(a=>a+moonRadiusKm);
  if(ellipsoidRayDistance(relativeKm,towardObserver.clone().negate(),expanded)===null)return null;
  return {planeKm:plane,alongKm:along};
}
export function createMoonTransitDiscs(objects) {
  const records=new Map();
  function proxy(parent,moon) {
    const material=moon.mesh.material.clone();
    material.userData={};bindPhysicalSun(material,moon.sunDirection);
    const mesh=new THREE.Mesh(moon.mesh.geometry.clone(),material);
    mesh.name=moon.id+'-physical-transit';mesh.userData.bodyId=moon.id;
    parent.root.add(mesh);
    return {mesh,sourceGeometry:moon.mesh.geometry,sourceMap:moon.mesh.material.map,moon,parent};
  }
  function update(frame,camera,{selected=null}={}) {
    for(const ids of Object.values(MOON_TRANSIT_SYSTEMS))for(const id of ids){const moon=objects.get(id);if(moon)moon.transitVisible=false;}
    for(const r of records.values()){r.mesh.visible=false;r.transit=null;}
    if(!frame || !camera)return;
    const rotation=skyRotation(frame.time.astronomy);
    for(const [parentId,ids] of Object.entries(MOON_TRANSIT_SYSTEMS)) {
      const parent=objects.get(parentId),p=frame.bodies.get(parentId);
      if(!parent||!p||!parent.root.visible)continue;
      const offset=camera.position.clone().sub(parent.root.position),distance=offset.length();
      const toward=offset.normalize(),inverseDisplay=parent.displayOrientation.clone().invert();
      const localToward=toward.clone().applyQuaternion(inverseDisplay),axes=physicalAxes(parentId);
      for(const id of ids) {
        const moon=objects.get(id),m=frame.bodies.get(id);
        if(!moon||!m||selected===id)continue;
        const relativeWorld=m.positionKm.clone().sub(p.positionKm).applyMatrix3(rotation);
        const relativeLocal=relativeWorld.clone().applyQuaternion(inverseDisplay);
        const moonAxes=physicalAxes(id),transit=observerTransit(relativeLocal,localToward,axes,Math.max(...moonAxes));
        if(!transit)continue;
        moon.transitVisible=true;
        let r=records.get(id);if(!r){r=proxy(parent,moon);records.set(id,r);}
        if(r.sourceGeometry!==moon.mesh.geometry){r.mesh.geometry.dispose();r.mesh.geometry=moon.mesh.geometry.clone();r.sourceGeometry=moon.mesh.geometry;}
        if(r.sourceMap!==moon.mesh.material.map){r.mesh.material.map=moon.mesh.material.map;r.sourceMap=moon.mesh.material.map;r.mesh.material.needsUpdate=true;}
        r.mesh.material.color.copy(moon.mesh.material.color);
        const localScale=parent.radius/axes[0],along=transit.alongKm*localScale;
        const depth=Math.min(along,distance*.5),perspective=(distance-depth)/distance;
        const projected=transit.planeKm.clone().applyQuaternion(parent.displayOrientation).multiplyScalar(localScale);
        r.mesh.position.copy(projected).multiplyScalar(perspective).addScaledVector(toward,depth);
        r.mesh.quaternion.copy(moon.displayOrientation);
        r.mesh.scale.setScalar(moonAxes[0]*localScale*perspective);
        r.mesh.visible=Boolean(r.sourceMap);
        // Hide the exaggerated orbital instance only while its physical disk is drawn.
        // setSceneVisibility restores it before the next update (or target switch).
        if(r.mesh.visible)moon.root.visible=false;
        r.transit={planeKm:transit.planeKm.toArray(),relativeLocalKm:relativeLocal.toArray(),
          alongKm:transit.alongKm,diameterKm:moonAxes[0]*2,displayDepth:depth,perspective};
      }
    }
  }
  function snapshot({camera,width=0,height=0}={}) {
    return [...records].map(([id,r])=>{
      const p=r.mesh.visible&&camera?r.mesh.getWorldPosition(new THREE.Vector3()).project(camera):null;
      return {id,parent:r.parent.id,visible:r.mesh.visible,...r.transit,
        sourceMesh:r.moon.mesh.uuid,texture:r.mesh.material.map?.image?.src||null,
        textureWidth:r.mesh.material.map?.image?.width||0,
        orientation:r.mesh.quaternion.toArray(),sunDirection:r.moon.sunDirection.toArray(),
        screen:p?{x:(p.x+1)*width/2,y:(1-p.y)*height/2}:null};
    });
  }
  function dispose(){for(const r of records.values()){r.mesh.removeFromParent();r.mesh.geometry.dispose();r.mesh.material.dispose();}records.clear();}
  return {update,snapshot,dispose};
}
