// Dedicated atmospheric weather and storm dynamics for Neptune.
//
// Observational grounding:
// 1. Supersonic retrograde equatorial jet (-400 to -600 m/s) reversing to prograde at mid-high latitudes.
// 2. Voyager 2 (1989) Great Dark Spot (GDS-89) at ~22°S with anticyclonic rotation and companion high-altitude
//    methane ice cirrus clouds along its equatorward (northern) flank.
// 3. "Scooter" at ~42°S: high-speed irregular bright convective cloud overtaking the GDS (period ~16.8h vs ~18.3h).
// 4. Mid-latitude discrete sheared cirrus streamers (~35°S/N) observed consistently by Hubble OPAL and Keck AO.
// 5. South polar warm collar and vortex (~70°-90°S) with thermal excess.
//
// All features remain strictly in the diffuse/albedo path; unlit night hemisphere has zero self-emission.
// Demonstration timing and cloud positions are illustrative.
import * as THREE from 'three';

export const NEPTUNE_STORM_DURATION = 16;

export function createNeptuneWeatherUniforms() {
  return {
    uNeptuneTime: { value: 0 },
    uNeptuneProgress: { value: -1 },
    uNeptuneActivity: { value: 0 },
    uNeptuneDetail: { value: 1 },
  };
}

const weather = /* glsl */ `
  uniform float uNeptuneTime;
  uniform float uNeptuneProgress;
  uniform float uNeptuneActivity;
  uniform float uNeptuneDetail;
  varying vec3 vNeptuneView;
  varying vec3 vNeptuneNormal;

  float neptuneHash(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float neptuneNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(neptuneHash(i), neptuneHash(i + vec3(1,0,0)), f.x),
      mix(neptuneHash(i + vec3(0,1,0)), neptuneHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(neptuneHash(i + vec3(0,0,1)), neptuneHash(i + vec3(1,0,1)), f.x),
      mix(neptuneHash(i + vec3(0,1,1)), neptuneHash(i + vec3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0;
  }

  float neptuneCloud(vec3 p) {
    // Drop unresolved high-frequency octaves to eliminate shimmering on small screens.
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    return .64 * neptuneNoise(p)
      + .26 * neptuneNoise(p * 2.11 + 5.3) * (1.0 - smoothstep(.25, 1.0, footprint * 2.11))
      + .10 * neptuneNoise(p * 4.23 - 3.7) * (1.0 - smoothstep(.25, 1.0, footprint * 4.23));
  }

  vec3 neptuneSphere(vec2 uv) {
    float longitude = uv.x * 6.2831853, latitude = (uv.y - .5) * 3.14159265;
    return vec3(-cos(longitude) * cos(latitude), sin(latitude), sin(longitude) * cos(latitude));
  }

  vec4 neptuneMap(sampler2D image, vec2 uv) {
    uv.y = clamp(uv.y, .002, .998);
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    dx.x -= floor(dx.x + .5); dy.x -= floor(dy.x + .5);
    return textureGrad(image, uv, dx, dy);
  }

  vec3 neptuneAtmosphere(sampler2D image, vec2 uv) {
    float time = uNeptuneTime;
    float activity = uNeptuneActivity;
    vec3 sphere = neptuneSphere(uv);
    float lat = asin(clamp(sphere.y, -1.0, 1.0));
    float absLat = abs(lat);

    // Supersonic zonal wind profile:
    // Neptune exhibits the fastest retrograde winds in the solar system: up to ~400-600 m/s (~1200-2100 km/h)
    // westward at the equator, reversing to eastward (prograde) at mid-to-high latitudes (~45°-55°).
    float jet = .0082 * exp(-pow(lat / .46, 2.0)) - .0026 * sin(absLat * 2.5) + .0008 * sin(lat * 14.0);

    // Two-phase advection cycle (28s) ensures continuous, non-repeating flow without seam shearing.
    float phase = fract(time / 28.0);
    vec2 ages = (vec2(phase, fract(phase + .5)) - .5) * 28.0;
    float blend = .5 - .5 * cos(phase * 6.2831853);

    vec2 advected = uv - vec2(jet * time, 0.0);
    vec3 air = neptuneSphere(advected);
    float eddy = neptuneCloud(air * vec3(18.0, 75.0, 18.0));
    vec2 warp = vec2(eddy * .0022, eddy * .0016 * cos(lat));

    vec3 sampleA = neptuneMap(image, uv + warp - vec2(jet * ages.x, 0.0)).rgb;
    vec3 sampleB = neptuneMap(image, uv + warp - vec2(jet * ages.y, 0.0)).rgb;
    // ages.y reaches zero offset at phase=0 and phase=1, so sampleB must carry the weight
    // that fades out. Mixing (sampleB, sampleA, blend) guarantees zero jump at cycle boundaries.
    vec3 colour = mix(sampleB, sampleA, blend);

    // Latitudinal shear filaments and turbulent zonal ripples:
    float filaments = neptuneCloud(air * vec3(56.0, 180.0, 56.0) + eddy * 1.2);
    float shearStrength = (.042 + activity * .010) * (.35 + .65 * uNeptuneDetail);
    colour *= 1.0 + filaments * shearStrength;

    // Great Dark Spot (GDS) anticyclonic vortex (~22°S):
    // Reference: Voyager 2 GDS-89 and subsequent Hubble dark spots (NDS-94, NDS-2018).
    // The spot drifts with the local zonal wind; appearance, position and timing are illustrative.
    float jetGds = .0082 * exp(-pow(-0.384 / .46, 2.0)) - .0026 * sin(0.384 * 2.5);
    vec2 gdsCenter = vec2(0.51 + jetGds * time * 0.92, 0.38);
    vec2 gdsDelta = uv - gdsCenter;
    gdsDelta.x -= floor(gdsDelta.x + 0.5);
    vec2 gdsCoord = gdsDelta / vec2(0.085, 0.045);
    float gdsRadius = length(gdsCoord);

    // Anticyclonic rotation (counter-clockwise in southern hemisphere):
    float turn = -time * 0.22;
    mat2 rot = mat2(cos(turn), -sin(turn), sin(turn), cos(turn));
    vec2 rotatedGds = rot * gdsCoord;
    float gdsSwirl = neptuneCloud(vec3(rotatedGds * 3.4, time * .08));
    float gdsMask = (1.0 - smoothstep(0.35, 1.25, gdsRadius + gdsSwirl * .18));
    float gdsDarkening = gdsMask * (.28 + activity * .06) * (.4 + .6 * uNeptuneDetail);
    colour *= 1.0 - gdsDarkening;

    // Companion bright methane cirrus clouds:
    // Bright white/cyan reflective methane ice crystal clouds along the northern (equatorward) flank of GDS.
    float northFlank = exp(-pow((gdsCoord.y - 0.85) / 0.40, 2.0)) * exp(-pow(gdsCoord.x / 1.35, 2.0));
    float cirrusNoise = neptuneCloud(vec3(gdsCoord * vec2(8.0, 16.0) - vec2(time * 0.42, 0.0), time * 0.12));
    float cirrusBright = smoothstep(0.08, 0.72, cirrusNoise + northFlank * 0.85) * northFlank;
    vec3 cirrusColor = vec3(0.92, 0.96, 1.12);
    colour = mix(colour, cirrusColor, cirrusBright * (.52 + activity * .065) * (.35 + .65 * uNeptuneDetail));

    // "Scooter" high-speed irregular bright cloud (~42°S):
    // In observations, Scooter swept around Neptune in ~16.8 hours, faster than GDS (~18.3 hours).
    float scooterSpeed = jetGds * 1.38;
    vec2 scooterCenter = vec2(0.18 + scooterSpeed * time, 0.27);
    vec2 scooterDelta = uv - scooterCenter;
    scooterDelta.x -= floor(scooterDelta.x + 0.5);
    vec2 scooterCoord = scooterDelta / vec2(0.042, 0.024);
    float scooterDist = length(scooterCoord);
    float scooterDetail = neptuneCloud(vec3(scooterCoord * 5.2, time * 0.15));
    float scooterMask = (1.0 - smoothstep(0.3, 1.2, scooterDist + scooterDetail * 0.25)) * smoothstep(-0.1, 0.5, scooterDetail + 0.3);
    colour = mix(colour, vec3(0.95, 0.98, 1.15), scooterMask * (.55 + activity * .060) * (.35 + .65 * uNeptuneDetail));

    // Sheared mid-latitude high-altitude cirrus streamers:
    float cirrusBand = exp(-pow((absLat - 0.56) / 0.14, 2.0));
    float cirrusStreamers = smoothstep(0.38, 0.85, neptuneCloud(air * vec3(28.0, 110.0, 28.0)));
    colour = mix(colour, vec3(0.90, 0.94, 1.10), cirrusStreamers * cirrusBand * (.15 + activity * .010) * (.35 + .65 * uNeptuneDetail));

    // South polar warm collar and vortex (~70°-90°S):
    float southPole = smoothstep(0.78, 0.96, -sphere.y);
    float polarR = length(sphere.xz);
    float polarAngle = atan(sphere.z, -sphere.x + .0000001);
    float polarWave = sin(polarAngle * 3.0 - time * 0.08);
    float polarCollar = exp(-pow((polarR - 0.22) / 0.065, 2.0)) * southPole;
    colour = mix(colour, colour * vec3(1.08, 1.12, 1.18), polarCollar * 0.35);

    // Cloud top slant-path methane & hydrocarbon haze at limb:
    // Remains strictly in the diffuse/albedo path so unlit night side has zero emission.
    float mu = abs(dot(normalize(vNeptuneNormal), normalize(vNeptuneView)));
    float haze = 1.0 - exp(-.036 / max(mu, .085));
    float luminance = dot(colour, vec3(.2126, .7152, .0722));
    return mix(colour, vec3(.72, .88, 1.12) * luminance, haze * .48);
  }
`;

export function patchNeptuneWeather(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey ? material.customProgramCacheKey() : 'standard';
  material.onBeforeCompile = function(shader, renderer) {
    if (previous) previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vNeptuneView; varying vec3 vNeptuneNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vNeptuneView = -(modelViewMatrix * vec4(position, 1.0)).xyz;
      vNeptuneNormal = normalMatrix * normal;`);
    shader.fragmentShader = weather + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        diffuseColor.rgb *= neptuneAtmosphere(map, vMapUv);
      #endif`);
  };
  material.customProgramCacheKey = () => key + '-neptune-weather-v1';
  material.needsUpdate = true;
}
