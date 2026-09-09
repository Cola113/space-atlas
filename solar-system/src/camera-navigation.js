import * as THREE from "three";

export const smoothProgress = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function cameraPath(start, target, offset, bodies) {
  const from = start.clone().sub(target);
  const startDistance = Math.max(from.length(), 1e-10);
  const endDistance = offset.length();
  from.normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(
    from,
    offset.clone().normalize(),
  );
  const rotation = new THREE.Quaternion();
  const bow = new THREE.Vector3();
  const position = (progress, output = new THREE.Vector3()) => {
    rotation.identity().slerp(turn, progress);
    const distance = Math.exp(
      THREE.MathUtils.lerp(
        Math.log(startDistance),
        Math.log(endDistance),
        progress,
      ),
    );
    return output
      .copy(from)
      .applyQuaternion(rotation)
      .multiplyScalar(distance)
      .add(target)
      .addScaledVector(bow, Math.sin(Math.PI * progress) ** 2);
  };

  // Check the entire route, including the space between samples, before departure.
  const segment = new THREE.Line3();
  const nearest = new THREE.Vector3();
  const candidates = [new THREE.Vector3()];
  const span = start.distanceTo(target.clone().add(offset));
  for (const height of [Math.max(4, span * 0.25), Math.max(12, span * 0.65)]) {
    for (const axis of [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    ]) {
      candidates.push(
        axis.clone().multiplyScalar(height),
        axis.clone().multiplyScalar(-height),
      );
    }
  }
  let best = candidates[0],
    bestClearance = -Infinity;
  for (const candidate of candidates) {
    bow.copy(candidate);
    let clearance = Infinity;
    segment.start.copy(start);
    for (let step = 1; step <= 80; step++) {
      position(step / 80, segment.end);
      for (const body of bodies) {
        segment.closestPointToPoint(body.root.position, true, nearest);
        clearance = Math.min(
          clearance,
          nearest.distanceTo(body.root.position) - body.radius * 1.08,
        );
      }
      segment.start.copy(segment.end);
    }
    if (clearance > bestClearance) {
      best = candidate;
      bestClearance = clearance;
    }
    if (clearance >= 0) break;
  }
  bow.copy(best);
  return position;
}

export function occludedByBody(point, observer, bodies, excludedId) {
  const direction = point.clone().sub(observer);
  const distance = direction.length();
  direction.divideScalar(distance || 1);
  for (const body of bodies) {
    if (body.id === excludedId) continue;
    const relative = body.root.position.clone().sub(observer);
    const along = relative.dot(direction);
    if (along <= 0 || along >= distance) continue;
    const perpendicularSquared = relative.cross(direction).lengthSq();
    if (perpendicularSquared < ((body.renderRadius || body.radius) * 0.99) ** 2)
      return true;
  }
  return false;
}
