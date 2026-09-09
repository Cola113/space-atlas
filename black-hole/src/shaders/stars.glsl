uniform sampler2D uStars;
uniform float uStarIntensity;
uniform float uStarLod;

vec3 starBackground(vec3 direction) {
  vec2 uv = vec2(atan(direction.z, direction.x) / 6.28318530718 + 0.5,
                 asin(clamp(direction.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
  // An explicit angular footprint gives reproducible filtering across framebuffer changes.
  // GPU-selected implicit/coarse derivatives can differ by a few quantization levels.
  // This is finite-area sky sampling, not point-source beam filtering at the critical curve.
  float polarFootprint = -0.5 * log2(max(0.04, 1.0-direction.y*direction.y));
  return textureLod(uStars, uv, clamp(uStarLod + polarFootprint, 0.0, 4.0)).rgb * uStarIntensity * 1.5;
}
