in vec2 vUv;
out vec4 outColor;

/*__NOISE__*/
/*__DISK__*/
/*__STARS__*/
/*__GEODESIC__*/

void main() {
  vec2 ndc = uPick > 0 ? uPickNdc : vUv * 2.0 - 1.0;
  vec3 localRay = normalize(vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));
  vec3 initialRay = normalize(uCameraBasis * localRay);
  RayResult ray = traceRay(initialRay);
  if (uPick > 0) {
    outColor = vec4(ray.structure / 255.0, ray.radius / 12.0, ray.angle / 6.28318530718 + 0.5, 1.0);
    return;
  }
  // Sample the same celestial sphere along the escaped geodesic direction.
  float escaped = step(0.5, dot(ray.escaped, ray.escaped));
  vec3 background = starBackground(mix(initialRay, ray.escaped, escaped)) * escaped;
  outColor = vec4(ray.emission + background * ray.transmittance, 1.0);
}
