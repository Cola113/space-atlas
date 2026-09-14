import * as THREE from 'three';

// Surface features must be placed with the same per-axis scaling the mesh uses,
// or markers sit above the surface wherever `shape` pulls it inward.
export function shapeSurfacePoint(body, point) {
  const [sx, sy, sz] = body.shape || [1, 1, 1];
  return point.set(point.x * sx, point.y * sy, point.z * sz);
}

// The outward normal of the ellipsoid, the gradient of x²/sx² + y²/sy² + z²/sz².
// On a flattened globe this is not the radius vector, and a camera placed along the
// radius looks at the marker off-axis; the difference reaches several degrees at
// mid latitudes on Saturn. Mutates `point`: pass a clone when the position is kept.
export function shapeSurfaceNormal(body, point) {
  const [sx, sy, sz] = body.shape || [1, 1, 1];
  return point.set(point.x / (sx * sx), point.y / (sy * sy), point.z / (sz * sz)).normalize();
}

export function createBodyGeometry(body, sphere) {
  if (!body.shape && !body.ridge) return sphere;
  const geometry = sphere.clone();
  const points = geometry.attributes.position;
  const [sx, sy, sz] = body.shape || [1, 1, 1];
  for (let i = 0; i < points.count; i++) {
    const latitude = points.getY(i);
    const ridge = body.ridge ? body.ridge.height * Math.exp(-Math.pow(latitude / body.ridge.width, 2)) : 0;
    const normalization = 1 + (body.ridge?.height || 0);
    points.setXYZ(i, points.getX(i) * sx * (1 + ridge) / normalization,
      latitude * sy / normalization, points.getZ(i) * sz * (1 + ridge) / normalization);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createNarrowRing(body) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(body.radius * body.rings.inner, body.radius * body.rings.outer, 192),
    // A small display fill keeps the thin ring legible at grazing sunlight.
    new THREE.MeshStandardMaterial({color: '#c5c5bf', emissive: '#aabbb3', emissiveIntensity: .09,
      roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: .72, depthWrite: false}),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.userData.bodyId = body.id;
  return ring;
}
