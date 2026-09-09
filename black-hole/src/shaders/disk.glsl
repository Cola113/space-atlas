uniform float uFlow;
uniform float uPulse;
uniform float uDiskIntensity;

float flowTexture(float r, float angle, float age) {
  float omega = 1.9 * pow(3.0 / r, 1.5);
  float theta = angle - omega * age;
  vec3 q = vec3(cos(theta) * 5.4, sin(theta) * 5.4, r * 4.4);
  float turbulent = fbm(q);
  float lanes = sin(r * 23.0 + turbulent * 8.0 + 0.8 * sin(theta * 4.0));
  float fine = noise3(vec3(cos(theta) * 24.0, sin(theta) * 24.0, r * 17.0));
  float knots = pow(max(0.0, noise3(q * vec3(1.4, 1.4, 0.3)) - 0.38) * 1.85, 3.0);
  float wisps = noise3(vec3(cos(theta) * 9.0, sin(theta) * 9.0, r * 22.0 + turbulent * 2.0));
  return (0.14 + 1.3 * turbulent * turbulent) * (0.88 + 0.12 * lanes) * (0.68 + 0.64 * wisps) * (0.80 + 0.40 * fine) + knots * 1.9;
}

vec4 diskEmission(vec3 point, vec3 photonBackwards, float observerRadius) {
  float r = length(point.xz);
  float edge = smoothstep(3.0, 3.25, r) * (1.0 - smoothstep(7.2, 9.0, r));
  float angle = atan(point.z, point.x);
  float a = uFlow, b = mod(uFlow + 24.0, 48.0);
  float blend = 0.5 - 0.5 * cos(a * 6.28318530718 / 48.0);
  float textureValue = mix(flowTexture(r, angle, b - 24.0), flowTexture(r, angle, a - 24.0), blend);
  textureValue *= 0.96 + 0.04 * sin(uPulse + angle * 3.0 + r);

  vec3 orbitDirection = normalize(vec3(-point.z, 0.0, point.x));
  float beta = sqrt(1.0 / (2.0 * (r - 1.0)));
  float gamma = inversesqrt(1.0 - beta * beta);
  float doppler = 1.0 / (gamma * (1.0 - beta * dot(orbitDirection, -photonBackwards)));
  float gravitational = sqrt((1.0 - 1.0 / r) / (1.0 - 1.0 / observerRadius));
  float g = clamp(doppler * gravitational, 0.35, 2.0);
  float temperature = pow(3.0 / r, 0.75) * g;
  vec3 warm = vec3(1.0, 0.22, 0.055);
  vec3 gold = vec3(1.0, 0.63, 0.25);
  vec3 hot = vec3(0.80, 0.89, 1.0);
  vec3 color = mix(warm, gold, smoothstep(0.22, 0.75, temperature));
  color = mix(color, hot, smoothstep(0.65, 1.35, temperature) * 0.92);
  float radial = pow(3.0 / r, 2.4);
  float intensity = 3.4 * radial * textureValue * pow(g, 3.0) * edge * uDiskIntensity;
  return vec4(color * intensity, edge * 0.96);
}
