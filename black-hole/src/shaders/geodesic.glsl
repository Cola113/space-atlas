uniform vec3 uEye;
uniform mat3 uCameraBasis;
uniform float uAspect;
uniform float uTanHalfFov;
uniform int uSteps;
uniform float uStepSize;
uniform int uPick;
uniform vec2 uPickNdc;

struct RayResult {
  vec3 emission;
  vec3 escaped;
  float transmittance;
  float structure;
  float radius;
  float angle;
};

vec2 derivative(vec2 uv) { return vec2(uv.y, 1.5 * uv.x * uv.x - uv.x); }

vec2 rk4(vec2 uv, float h) {
  vec2 k1 = derivative(uv);
  vec2 k2 = derivative(uv + h * 0.5 * k1);
  vec2 k3 = derivative(uv + h * 0.5 * k2);
  vec2 k4 = derivative(uv + h * k3);
  return uv + h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
}

// Schwarzschild null geodesic, rs = c = 1 (Bruneton 2020, equation 8).
// The local static-observer tetrad fixes b and du/dphi at the camera.
RayResult traceRay(vec3 ray) {
  RayResult result = RayResult(vec3(0), vec3(0), 1.0, 0.0, 0.0, 0.0);
  float r0 = length(uEye);
  vec3 er = uEye / r0;
  float cosine = clamp(dot(ray, er), -1.0, 1.0);
  vec3 tangent = ray - cosine * er;
  float sine = length(tangent);
  if (sine < 0.00001) {
    if (cosine < 0.0) { result.structure = 1.0; result.transmittance = 0.0; }
    else result.escaped = ray;
    return result;
  }
  vec3 et = tangent / sine;
  float impact = r0 * sine / sqrt(1.0 - 1.0 / r0);
  vec2 state = vec2(1.0 / r0, -cosine / impact);
  float phi = 0.0;
  float crossPhi = mod(atan(-er.y, et.y), 3.14159265359);
  if (crossPhi < 0.00001) crossPhi += 3.14159265359;
  vec3 crossDirection = er * cos(crossPhi) + et * sin(crossPhi);
  int crossings = 0;
  for (int i = 0; i < 640; i++) {
    if (i >= uSteps) break;
    float h = min(uStepSize, crossPhi - phi);
    h = min(h, 0.09 / max(abs(state.y), 0.01));
    vec2 previous = state;
    state = rk4(state, h);
    phi += h;
    if (state.x >= 1.0) {
      if (result.structure < 0.5) result.structure = 1.0;
      result.transmittance = 0.0;
      return result;
    }
    if (state.x <= 0.0) {
      float fraction = previous.x / max(previous.x - state.x, 0.00000001);
      float escapePhi = phi - h + h * fraction;
      result.escaped = er * cos(escapePhi) + et * sin(escapePhi);
      return result;
    }
    if (phi >= crossPhi - 0.000001) {
      float r = 1.0 / state.x;
      if (r >= 3.0 && r <= 9.0 && uPick != 2) {
        vec3 point = crossDirection * r;
        vec3 angular = -er * sin(phi) + et * cos(phi);
        // Convert the spatial tangent into the emitter's local static frame.
        vec3 localRay = normalize(-state.y / sqrt(1.0 - state.x) * crossDirection + state.x * angular);
        vec4 disk = diskEmission(point, localRay, r0);
        if (result.structure < 0.5 && disk.a > 0.12) {
          result.structure = crossings == 0 ? 2.0 : 3.0;
          result.radius = r;
          result.angle = atan(point.z, point.x);
        }
        result.emission += result.transmittance * disk.rgb;
        result.transmittance *= 1.0 - disk.a;
        if (result.transmittance < 0.015) return result;
      }
      crossings++;
      crossPhi += 3.14159265359;
      crossDirection = -crossDirection;
    }
    if (phi > 12.56637061) break;
  }
  // Unresolved, extremely high-order rays are absorbed, not replaced by an unbent sky.
  if (result.structure < 0.5) result.structure = 1.0;
  result.transmittance = 0.0;
  return result;
}
