import { Vector2 } from 'three';

// Venusian atmospheric superrotation, planetary-scale Y-wave and polar circulation.
// Ground-truth references: Pioneer Venus, Mariner 10, Venus Express (VIRTIS), and Akatsuki (JAXA).
// See BODY_MODELS.md, “金星大气超级自转与行星尺度云波”. All rates below are demonstration rates.
export const VENUS_WAVE_DURATION = 18;

export function createVenusWeatherUniforms() {
  return {
    uVenusTime: { value: 0 },
    uVenusProgress: { value: -1 },
    uVenusCloudVisible: { value: 1 },
    uVenusActivity: { value: 0 },
    uVenusDetail: { value: 1 },
  };
}

const weather = /* glsl */ `
  uniform float uVenusTime;
  uniform float uVenusProgress;
  uniform float uVenusCloudVisible;
  uniform float uVenusActivity;
  uniform float uVenusDetail;
  varying vec3 vVenusView;
  varying vec3 vVenusNormal;

  float venusHash(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float venusNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(venusHash(i), venusHash(i + vec3(1,0,0)), f.x),
      mix(venusHash(i + vec3(0,1,0)), venusHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(venusHash(i + vec3(0,0,1)), venusHash(i + vec3(1,0,1)), f.x),
      mix(venusHash(i + vec3(0,1,1)), venusHash(i + vec3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0;
  }

  float venusCloud(vec3 p) {
    // Drop unresolved octaves instead of making them sparkle on small screens.
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    return .64 * venusNoise(p)
      + .26 * venusNoise(p * 2.08 + 5.7) * (1.0 - smoothstep(.25, 1.0, footprint * 2.08))
      + .10 * venusNoise(p * 4.15 - 3.2) * (1.0 - smoothstep(.25, 1.0, footprint * 4.15));
  }

  vec3 venusSphere(vec2 uv) {
    float longitude = uv.x * 6.2831853, latitude = (uv.y - .5) * 3.14159265;
    return vec3(-cos(longitude) * cos(latitude), sin(latitude), sin(longitude) * cos(latitude));
  }

  // A triggered event speeds the advection up; the bounded cycle keeps the offsets in range, so a
  // faster flow does not stretch the map.
  float venusFlowGain(float a) { return 1.0 + a * .55; }

  vec4 venusMap(sampler2D image, vec2 uv) {
    uv.y = clamp(uv.y, .002, .998);
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    dx.x -= floor(dx.x + .5); dy.x -= floor(dy.x + .5);
    return textureGrad(image, uv, dx, dy);
  }

  vec3 venusAtmosphere(sampler2D image, vec2 uv) {
    // When clouds are toggled off, pass through the radar surface map without modification.
    if (uVenusCloudVisible < 0.5) {
      return venusMap(image, uv).rgb;
    }

    float time = uVenusTime;
    float activity = uVenusActivity;
    vec3 sphere = venusSphere(uv);
    float lat = asin(clamp(sphere.y, -1.0, 1.0));
    float absLat = abs(lat);

    // Fast westward superrotation: prominent equatorial/low-latitude jet, tapering toward poles.
    // The globe's cloud-top map is almost featureless along longitude, so the drift alone barely reads on
    // screen; the tracers below carry the visible motion.
    float jet = .0068 * (exp(-pow(lat / .85, 2.0)) + .24 * cos(lat * 1.5));

    // Two-phase advection cycle (28s) ensures smooth, non-repeating flow without seam shearing.
    float phase = fract(time / 28.0);
    vec2 ages = (vec2(phase, fract(phase + .5)) - .5) * 28.0;
    float blend = .5 - .5 * cos(phase * 6.2831853);

    vec2 advected = uv - vec2(jet * time * venusFlowGain(activity), 0.0);
    vec3 air = venusSphere(advected);
    float eddy = venusCloud(air * vec3(14.0, 68.0, 14.0));
    vec2 warp = vec2(eddy * .0016, eddy * .0012 * sin(lat * 3.14159265));

    vec3 sampleA = venusMap(image, uv + warp - vec2(jet * ages.x * venusFlowGain(activity), 0.0)).rgb;
    vec3 sampleB = venusMap(image, uv + warp - vec2(jet * ages.y * venusFlowGain(activity), 0.0)).rgb;
    // The sample on ages.y is the one that sits at zero offset on both ends of the cycle, so it has to
    // carry the weight that fades out. Mixing them the other way round makes the clouds jump once per
    // 28-second cycle. Same ordering as the Saturn module.
    vec3 colour = mix(sampleB, sampleA, blend);

    // Planetary-scale Y-wave / chevron feature:
    // Arms open eastward into mid-latitudes, stem along equator, drifting westward with flow.
    float waveSpeed = .0042;
    float waveLon = (uv.x - waveSpeed * time) * 6.2831853;
    float chevron = waveLon + 1.8 * pow(absLat, 1.25);
    float yPattern = cos(chevron) * .72 + cos(chevron * 2.0 - .8) * .28;
    float waveMask = exp(-pow(absLat / .85, 2.5));
    float waveModulation = yPattern * waveMask * (.088 + activity * .085);
    colour *= 1.0 + waveModulation;

    // Mid-latitude sheared cloud streaks:
    float streaks = venusCloud(air * vec3(48.0, 190.0, 48.0) + eddy * 1.1);
    float streakMask = smoothstep(.18, .45, absLat) * (1.0 - smoothstep(.75, 1.1, absLat));
    colour *= 1.0 + streakMask * (streaks * (.034 + activity * .042) * (.35 + .65 * uVenusDetail));

    // Long-lived cloud patches that travel with the flow. Unlike the two-phase base-map cross-fade,
    // these are evaluated at one drifting position, so the eye can follow them across the disc.
    float patches = venusCloud(venusSphere(uv - vec2(jet * time * .72 * venusFlowGain(activity), 0.0)) * vec3(19.0, 96.0, 19.0));
    colour *= 1.0 + patches * (.030 + activity * .026) * waveMask;

    // Polar cold collar & dipole vortex circulation (near both poles):
    float r = length(sphere.xz);
    float polarAngle = atan(sphere.z, -sphere.x + .0000001);
    float north = smoothstep(.85, .96, sphere.y);
    float south = smoothstep(.85, .96, -sphere.y);
    float polarZone = max(north, south);

    // Bright cold collar ring near ~65-75 degrees latitude:
    float collarCenter = .22;
    float collar = exp(-pow((r - collarCenter) / .055, 2.0)) * polarZone;
    colour = mix(colour, colour * vec3(1.05, 1.04, 1.01), collar * .45);

    // Polar dipole vortex rotating inside the collar:
    float vortexAngle = polarAngle - (sphere.y > 0.0 ? 1.0 : -1.0) * time * .12;
    float dipoleWave = sin(vortexAngle * 2.0);
    float dipoleCloud = venusCloud(vec3(cos(vortexAngle * 2.0) * 12.0, sin(vortexAngle * 2.0) * 12.0, r * 65.0));
    float eyeMask = (1.0 - smoothstep(.01, .18, r)) * polarZone;
    float dipole = (dipoleWave * .6 + dipoleCloud * .4) * eyeMask;
    colour *= 1.0 + dipole * .065;

    // Stationary highland bow wave (Aphrodite Terra):
    // Fixed relative to the solid surface, visible as clouds blow through it.
    vec2 highlandCenter = vec2(.28, .50);
    vec2 mDelta = uv - highlandCenter;
    mDelta.x -= floor(mDelta.x + .5);
    float bowShape = mDelta.x + .75 * abs(mDelta.y);
    float bowEnv = exp(-pow(bowShape / .075, 2.0)) * exp(-pow(mDelta.y / .18, 2.0));
    float bowWave = bowEnv * sin(bowShape * 110.0);
    colour *= 1.0 + bowWave * .032;

    // Slant-path sulfuric acid haze at the cloud tops:
    // Lowers limb contrast into soft warm creaminess while staying in the albedo path.
    // Unlit night side remains dark; no unphysical emissive rim glow.
    float mu = abs(dot(normalize(vVenusNormal), normalize(vVenusView)));
    float haze = 1.0 - exp(-.038 / max(mu, .085));
    float luminance = dot(colour, vec3(.2126, .7152, .0722));
    return mix(colour, vec3(1.03, 1.00, .92) * luminance, haze * .55);
  }
`;

export function patchVenusWeather(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey ? material.customProgramCacheKey() : 'standard';
  material.onBeforeCompile = function(shader, renderer) {
    if (previous) previous.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec3 vVenusView; varying vec3 vVenusNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vVenusView = -(modelViewMatrix * vec4(position, 1.0)).xyz;
      vVenusNormal = normalMatrix * normal;`);
    shader.fragmentShader = weather + '\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        diffuseColor.rgb *= venusAtmosphere(map, vMapUv);
      #endif`);
  };
  material.customProgramCacheKey = () => key + '-venus-weather-v1';
  material.needsUpdate = true;
}
