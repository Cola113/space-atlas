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

// The globe is a sphere moved by a linear map, so its normals are that map's inverse
// transpose applied to the sphere's own normals — not a per-face average. Recomputing
// them with `computeVertexNormals` is what put a meridian line on every shaped body: the
// sphere's texture seam is a duplicated column of vertices, and a per-face average gives
// those two columns different normals (up to three degrees apart, and degenerate at the
// poles, where the triangle fan collapses), so a crease runs pole to pole exactly where
// the texture wraps. The transform below depends only on the vertex, so the twins come
// out identical, and it is the exact ellipsoid normal rather than a faceted approximation.
//
// With the equatorial ridge the map is no longer linear: the ridge multiplies the
// equatorial components by m(y) = 1 + height * exp(-(y/width)²) before the same per-axis
// scaling. Its Jacobian is still diagonal except for one row, and the inverse transpose
// of that is the closed form worked out below, with m' = dm/dy.
export function createBodyGeometry(body, sphere) {
  if (!body.shape && !body.ridge) return sphere;
  const geometry = sphere.clone();
  const points = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const [sx, sy, sz] = body.shape || [1, 1, 1];
  const height = body.ridge?.height || 0, width = body.ridge?.width || 1;
  const normalization = 1 + height;
  for (let i = 0; i < points.count; i++) {
    const latitude = points.getY(i);
    const ridge = height ? height * Math.exp(-Math.pow(latitude / width, 2)) : 0;
    const equatorial = 1 + ridge;
    const slope = height ? -2 * latitude * ridge / (width * width) : 0;
    points.setXYZ(i, points.getX(i) * sx * equatorial / normalization,
      latitude * sy / normalization, points.getZ(i) * sz * equatorial / normalization);
    const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
    // The unit sphere's normal is its position, so 1 - y² is nx² + nz².
    const vx = nx / (sx * equatorial);
    const vy = (ny - slope * (nx * nx + nz * nz) / equatorial) / sy;
    const vz = nz / (sz * equatorial);
    const length = Math.hypot(vx, vy, vz) || 1;
    normals.setXYZ(i, vx / length, vy / length, vz / length);
  }
  // The normals are written from the positions, so they have to be marked.
  normals.needsUpdate = true;
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
