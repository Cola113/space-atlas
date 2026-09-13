import { Quaternion } from 'three';

export function restoreFollowRotation(saved) {
  return typeof saved?.followRotation==='boolean' ? saved.followRotation : saved?.lockSpin === true;
}
// Rebinding/enabling records the current attitude. Subsequent changes move the
// camera; dragging changes its current offset and is naturally retained.
export class RotationFollow {
  constructor(){this.id=null;this.previous=new Quaternion();this.active=false;}
  reset(){this.id=null;this.active=false;}
  update(body,camera,target,enabled){
    const active=Boolean(enabled && body?.physicalAvailable);
    if(active && this.active && this.id===body.id){
      const delta=body.displayOrientation.clone().multiply(this.previous.clone().invert());
      camera.position.sub(body.root.position).applyQuaternion(delta).add(body.root.position);
      target.sub(body.root.position).applyQuaternion(delta).add(body.root.position);
    }
    this.id=body?.id ?? null;this.active=active;
    if(body?.displayOrientation)this.previous.copy(body.displayOrientation);
  }
}
