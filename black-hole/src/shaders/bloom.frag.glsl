uniform sampler2D uSource;
uniform vec2 uDirection;
uniform float uThreshold;
in vec2 vUv;
out vec4 outColor;
vec3 sampleBright(vec2 uv) {
  vec3 c = texture(uSource, uv).rgb;
  float brightness = max(max(c.r,c.g),c.b);
  return c * (uThreshold < 0.0 ? 1.0 : max(0.0, brightness - uThreshold) / max(brightness, 0.0001));
}
void main() {
  vec3 c = sampleBright(vUv) * 0.227027;
  c += sampleBright(vUv + uDirection * 1.384615) * 0.316216;
  c += sampleBright(vUv - uDirection * 1.384615) * 0.316216;
  c += sampleBright(vUv + uDirection * 3.230769) * 0.070270;
  c += sampleBright(vUv - uDirection * 3.230769) * 0.070270;
  outColor = vec4(c, 1.0);
}
