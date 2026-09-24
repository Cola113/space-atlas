import { Vector2 } from 'three';

// Neptune-specific atmospheric weather. Like saturn-weather.js and venus-weather.js this
// module owns the globe's map_fragment outright; the generic gasMap path no longer runs
// for Neptune. The global texture is never repainted: motion comes from shifting, shearing
// and churning the existing map, all inside the diffuse/albedo path so the unlit night
// hemisphere keeps zero self-emission.
//
// Observational grounding:
// 1. The fastest winds in the solar system, and bimodal: cloud-top winds blow WESTWARD
//    (retrograde, opposite the planet's rotation) at ~400 m/s along the equator, while
//    narrow PROGRADE jets blow eastward at high latitudes (~300 m/s near 70°S, Voyager 2;
//    tracked features span ~20 m/s eastward to ~325 m/s westward).
// 2. Dark spots are transient tropospheric vortices — holes in the upper cloud deck.
//    Voyager 2 saw two at once in 1989 (the Earth-sized Great Dark Spot near 22°S plus a
//    Small Dark Spot); Hubble saw more in 2016 (~4,800 km across) and 2018, where bright
//    companion methane clouds appeared BEFORE the dark core and outlived it
//    (Simon et al. 2019, doi:10.1029/2019GL081961). Spots tend to dissipate as they
//    migrate close to the equator.
// 3. "Scooter": a small bright cloud group near ~42°S that overtook the Great Dark Spot
//    in 1989 time-lapses of the Voyager encounter.
// 4. The shipped texture already carries an artistically enhanced Great Dark Spot with
//    companion clouds (data.js: "蓝色贴图经过增强，风暴并非实时观测"). The shader keeps that
//    oval where it is and only churns it gently, so no second dark oval is ever painted
//    on top of it; triggered events instead grow a NEW vortex elsewhere, the way 1989
//    had two spots at once and Hubble kept finding short-lived ones.
//
// All drift rates, sizes, origins and event timing are demonstration choices accelerated
// for display — not a forecast, and no observed longitude or date is claimed for the
// transient vortex. See BODY_MODELS.md, “海王星大气与暗斑涡旋”.
export const NEPTUNE_VORTEX_DURATION = 22;

// Demonstration birthplaces for the transient vortex, alternating hemispheres the way the
// 1989 southern pair and the 2016/2018 short-lived Hubble spots did. Successive events
// step the meridian so a new vortex is not born where the previous one died.
const VORTEX_ORIGINS = [
  { u: .21, v: .315 }, // southern hemisphere, ~ -33°
  { u: .76, v: .685 }, // northern hemisphere, ~ +33°
];
export function neptuneVortexOrigin(eventCount = 0) {
  const base = VORTEX_ORIGINS[eventCount % 2];
  const u = ((base.u + Math.floor(eventCount / 2) * .31) % 1 + 1) % 1;
  return { u, v: base.v };
}

export function neptuneVortexUv(elapsed = 0, origin = VORTEX_ORIGINS[0]) {
  // Westward drift plus a slow push toward the equator, where dark spots dissipate.
  const u = ((origin.u - elapsed * .0016) % 1 + 1) % 1;
  const v = origin.v + Math.sign(.5 - origin.v) * elapsed * .0007;
  return [u, v];
}

export function createNeptuneWeatherUniforms() {
  return {
    uNeptuneTime: { value: 0 },
    uNeptuneProgress: { value: -1 },
    uNeptuneSpot: { value: new Vector2(...neptuneVortexUv()) },
    uNeptuneActivity: { value: 0 },
    uNeptuneDetail: { value: 1 },
  };
}

const weather = /* glsl */ `
  uniform float uNeptuneTime;
  uniform float uNeptuneProgress;
  uniform vec2 uNeptuneSpot;
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
    // Drop unresolved octaves instead of making them sparkle on small screens.
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    return .64 * neptuneNoise(p)
      + .26 * neptuneNoise(p * 2.08 + 5.9) * (1.0 - smoothstep(.25, 1.0, footprint * 2.08))
      + .10 * neptuneNoise(p * 4.16 - 3.4) * (1.0 - smoothstep(.25, 1.0, footprint * 4.16));
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

  // Replace an offset with its rotated version, fading the rotation out by ~1.6 radii.
  // Same bounded churn the Jupiter path applies around its storm oval.
  vec2 neptuneChurn(vec2 p, vec2 center, vec2 size, float angle) {
    vec2 d = p - center;
    d.x -= floor(d.x + .5);
    vec2 q = d / size;
    float a = angle * (1.0 - smoothstep(.3, 1.6, length(q)));
    q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
    return p + q * size - d;
  }

  // The dark oval baked into the global texture, measured on 2k_neptune.jpg (~16°S).
  const vec2 gdsCenter = vec2(.563, .409);
  const vec2 gdsSize = vec2(.070, .046);

  vec3 neptuneAtmosphere(sampler2D image, vec2 uv) {
    float time = uNeptuneTime;
    float detail = uNeptuneDetail;
    float activity = uNeptuneActivity;
    vec3 sphere = neptuneSphere(uv);
    float lat = asin(clamp(sphere.y, -1.0, 1.0));
    float poleFade = pow(max(sin(uv.y * 3.14159265), 0.0), 2.0);

    // Bimodal zonal flow: a retrograde westward core across the equator and prograde
    // eastward lobes at mid-high latitudes. Positive drift moves features toward +u,
    // the prograde direction of the shared body rotation. The coefficient stays fixed
    // while detail only scales the tracers, so focus changes never jump the texture.
    float jet = -.0019 * exp(-pow(lat / .34, 2.0))
      + .0011 * exp(-pow((abs(lat) - 1.05) / .36, 2.0))
      + .00026 * sin(lat * 23.0);

    // Bounded two-phase advection (26 s): each latitude row shifts rigidly, adjacent rows
    // shear against each other, and the resetting sample always carries zero weight.
    float phase = fract(time / 26.0);
    vec2 ages = (vec2(phase, fract(phase + .5)) - .5) * 26.0;
    float blend = .5 - .5 * cos(phase * 6.2831853);
    float churn = .045 + activity * .04;
    vec2 advected = uv - vec2(jet * time, 0.0);
    vec3 air = neptuneSphere(advected);
    float eddy = neptuneCloud(air * vec3(11.0, 56.0, 11.0));
    vec2 warp = vec2(0.0, eddy * .0017 * poleFade * detail);
    vec2 uvA = neptuneChurn(advected + warp - vec2(jet * ages.x, 0.0), gdsCenter, gdsSize, ages.x * churn);
    vec2 uvB = neptuneChurn(advected + warp - vec2(jet * ages.y, 0.0), gdsCenter, gdsSize, ages.y * churn);
    vec3 colour = mix(neptuneMap(image, uvB).rgb, neptuneMap(image, uvA).rgb, blend);

    // Fine bright methane-ice cirrus streaks ride the prograde jets at mid-high
    // latitudes; they are what makes the differential flow readable on screen.
    float cirrusBand = smoothstep(.55, .80, abs(lat)) * (1.0 - smoothstep(1.15, 1.38, abs(lat)));
    float cirrus = neptuneCloud(air * vec3(46.0, 195.0, 46.0) + eddy * 1.2);
    colour *= 1.0 + cirrusBand * cirrus * (.034 + activity * .045) * detail;

    // "Scooter": a small bright cloud group near 42°S on its own fast westward drift —
    // it overtakes the dark spot the way it did in the 1989 Voyager time-lapses.
    float scooterDU = uv.x - .62 + .0055 * time;
    scooterDU -= floor(scooterDU + .5);
    float scooterDV = uv.y - .267;
    float scooterWisp = neptuneCloud(vec3(scooterDU * 60.0, scooterDV * 240.0, time * .05));
    float scooter = exp(-pow(scooterDU / .020, 2.0) - pow(scooterDV / .011, 2.0));
    colour += vec3(.050, .058, .070) * scooter * (.55 + .45 * scooterWisp)
      * (.65 + activity * .95) * detail;

    // South polar dark eye: a slowly turning mottled deepening near the pole (Voyager 2).
    // Cartesian coordinates keep the pole free of longitude pinching.
    float southPole = smoothstep(1.24, 1.55, -lat);
    float poleTurn = time * .03;
    vec2 polarCoord = mat2(cos(poleTurn), -sin(poleTurn), sin(poleTurn), cos(poleTurn))
      * vec2(sphere.x, sphere.z);
    float polarMottle = neptuneCloud(vec3(polarCoord * 42.0, sphere.y * 24.0));
    colour *= 1.0 - southPole * (.03 + .03 * (polarMottle * .5 + .5)) * detail;

    // A storm event grows a NEW dark vortex elsewhere on the disc. The bright companion
    // cirrus appears first and outlives the core (Simon et al. 2019); the core deepens,
    // drifts westward and equatorward on the CPU-driven uNeptuneSpot, then dissipates.
    if (uNeptuneProgress >= 0.0 && uNeptuneProgress < 1.0) {
      float progress = uNeptuneProgress;
      vec2 delta = uv - uNeptuneSpot;
      delta.x -= floor(delta.x + .5);
      float grow = smoothstep(0.0, .45, progress);
      vec2 size = mix(vec2(.012, .008), vec2(.052, .034), grow);
      vec2 q = delta / size;
      float radius = length(q);

      // Companions lead by roughly a seventh of the event and linger past the core,
      // the compressed stand-in for their years-long lead over the 2018 spot. Noise
      // breaks each flank band into discrete wisps so no uniform bright bar appears;
      // the stronger field rides the equatorward edge, as in the Voyager imagery.
      float eqSign = sign(.5 - uNeptuneSpot.y);
      float companion = smoothstep(.02, .15, progress) * (1.0 - smoothstep(.78, .97, progress));
      float wisp = neptuneCloud(vec3(delta.x * 170.0, delta.y * 420.0, time * .06));
      vec2 primary = vec2(delta.x / (size.x * .72),
        (delta.y - eqSign * size.y * 1.10) / (size.y * .34));
      float primaryGlow = exp(-pow(primary.x, 2.0) - pow(primary.y, 2.0))
        * (.40 + .60 * smoothstep(-.1, .8, wisp));
      vec2 secondary = vec2(delta.x / (size.x * .95),
        (delta.y + eqSign * size.y * 1.15) / (size.y * .40));
      float secondaryGlow = exp(-pow(secondary.x, 2.0) - pow(secondary.y, 2.0))
        * (.36 + .64 * smoothstep(-.6, .5, -wisp));
      colour = mix(colour, vec3(.94, .97, 1.06),
        (primaryGlow + secondaryGlow * .55) * companion * .42);

      float core = smoothstep(.14, .34, progress) * (1.0 - smoothstep(.70, .92, progress));
      float spin = time * .22 + 2.2 * exp(-radius * .9);
      vec2 rolled = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * q;
      float mottle = neptuneCloud(vec3(rolled * 2.4, time * .06 + progress * 1.7));
      float oval = 1.0 - smoothstep(.50, 1.20, radius + mottle * .20);
      // Red darkens most so the oval reads deeper blue, the way dark vortices show best
      // at blue wavelengths.
      colour *= 1.0 - oval * core * (.33 + .07 * mottle) * vec3(1.13, 1.0, .86);
    }

    // Slant-path haze at the cloud tops, in the albedo path so real sunlight still
    // darkens every layer; the unlit hemisphere gains no self-emission.
    float mu = abs(dot(normalize(vNeptuneNormal), normalize(vNeptuneView)));
    float haze = 1.0 - exp(-.028 / max(mu, .09));
    float luminance = dot(colour, vec3(.2126, .7152, .0722));
    return mix(colour, vec3(.93, .97, 1.06) * luminance, haze * .42);
  }
`;

// Compose with the shared activity patch and any existing illumination hooks.
export function patchNeptuneWeather(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    previous.call(this, shader, renderer);
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
