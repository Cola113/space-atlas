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
// 2. Dark spots are transient tropospheric vortices. VLT/MUSE spectra (2023) favour
//    darkening in a deep aerosol layer, not a hole in the upper cloud deck.
//    Voyager 2 saw two at once in 1989 (the Earth-sized Great Dark Spot near 22°S plus a
//    Small Dark Spot); Hubble saw more in 2016 (~4,800 km across) and 2018, where bright
//    companion methane clouds appeared BEFORE the dark core and outlived it
//    (Simon et al. 2019, doi:10.1029/2019GL081961). Spots tend to dissipate as they
//    migrate close to the equator.
// 3. "Scooter": a small bright cloud group near ~42°S that overtook the Great Dark Spot
//    in 1989 time-lapses of the Voyager encounter.
// 4. The shipped texture already carries an artistically enhanced Great Dark Spot with
//    companion clouds (data.js: "蓝色贴图经过增强，风暴并非实时观测"). The shader keeps that
//    feature at its landmark and deforms its outline, so no second dark oval is painted
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
    uNeptuneSeed: { value: 0 },
  };
}

const weather = /* glsl */ `
  uniform float uNeptuneTime;
  uniform float uNeptuneProgress;
  uniform vec2 uNeptuneSpot;
  uniform float uNeptuneActivity;
  uniform float uNeptuneDetail;
  uniform float uNeptuneSeed;
  varying vec3 vNeptuneView;
  varying vec3 vNeptuneNormal;

  // GLSL pow(x, 2.0) is undefined for negative x on some GPU drivers.
  float neptuneSquare(float x) { return x * x; }

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

  vec2 neptuneRotate(vec2 p, float a) {
    return mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
  }

  vec2 neptuneDelta(vec2 p, vec2 center) {
    vec2 d = p - center;
    d.x -= floor(d.x + .5);
    return d;
  }

  // The dark oval baked into the global texture, measured on 2k_neptune.jpg (~16°S).
  const vec2 gdsCenter = vec2(.563, .409);
  const vec2 gdsSize = vec2(.070, .046);

  // Deform the EXISTING dark feature, keeping its centre at the catalogue landmark.
  // Area-preserving strain and travelling edge billows change its aspect and tilt.
  // No unbounded longitude offset, rigid spinning oval or phase-crossfaded double spot.
  vec2 neptuneGdsMap(vec2 uv, float time) {
    vec2 d = neptuneDelta(uv, gdsCenter), q = d / gdsSize;
    float r = length(q);
    float influence = 1.0 - smoothstep(.65, 1.9, r);
    float strain = .13 * sin(time * .21) + .065 * sin(time * .37 + .8);
    vec2 shaped = neptuneRotate(q, .13 * sin(time * .17));
    shaped *= vec2(exp(strain), exp(-strain));
    shaped.x += .16 * sin(q.y * 2.8 + time * .34) * q.y;
    shaped.y += .10 * sin(q.x * 3.3 - time * .42) * q.x;
    vec2 moving = neptuneRotate(q, -time * .14 / (1.0 + r * .65));
    vec2 billow = vec2(neptuneNoise(vec3(moving * 3.1, 2.7)),
      neptuneNoise(vec3(moving * 3.1 + 8.4, 6.1)));
    shaped += billow * .13 * smoothstep(.25, .85, r);
    return uv + (shaped - q) * gdsSize * influence;
  }

  // Broken, stretched methane-ice filaments, carried along the rim at a different
  // speed from the dark material. The envelope is deliberately one-sided and open.
  // This is a morphology model, not a resolved fluid simulation.
  float neptuneCompanions(vec2 q, float time, float seed) {
    float edge = neptuneNoise(vec3(q.x * 2.7 - time * .22, q.y * 2.1, seed));
    float bend = .15 * sin(q.x * 2.4 - time * .31 + seed) + edge * .16;
    float north = q.y - (.86 - .22 * q.x * q.x + .12 * q.x + bend);
    float south = q.y - (-.91 + .17 * q.x * q.x + .10 * sin(q.x * 3.0 + time * .27));
    float upper = exp(-neptuneSquare(north / .16) - neptuneSquare(neptuneSquare((q.x + .23) / 1.10)));
    float lower = exp(-neptuneSquare(south / .12) - neptuneSquare((q.x - .50) / .65)) * .48;
    // Multiple lengths, with holes rather than a continuous bright outline.
    float wisps = neptuneCloud(vec3(q.x * 5.2 - time * .46,
      (q.y - bend) * 23.0 + edge * 2.4, seed + time * .035));
    float patches = smoothstep(-.42, .38,
      neptuneNoise(vec3(q.x * 3.8 - time * .28, q.y * 5.0, seed + 9.0)));
    float strands = smoothstep(-.40, .55, wisps);
    float tailY = q.y - (.45 + .24 * (q.x + 1.0) + bend);
    float tail = exp(-neptuneSquare(tailY / .13))
      * smoothstep(-2.7, -1.4, q.x) * (1.0 - smoothstep(-1.1, -.65, q.x));
    return (upper + lower + tail * .42) * patches * (.14 + .86 * strands);
  }

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
    float jet = -.0019 * exp(-neptuneSquare(lat / .34))
      + .0011 * exp(-neptuneSquare((abs(lat) - 1.05) / .36))
      + .00026 * sin(lat * 23.0);

    // Bounded two-phase advection (26 s): each latitude row shifts rigidly, adjacent rows
    // shear against each other, and the resetting sample always carries zero weight.
    float phase = fract(time / 26.0);
    vec2 ages = (vec2(phase, fract(phase + .5)) - .5) * 26.0;
    float blend = .5 - .5 * cos(phase * 6.2831853);
    vec2 advected = uv - vec2(jet * time, 0.0);
    vec3 air = neptuneSphere(advected);
    float eddy = neptuneCloud(air * vec3(11.0, 56.0, 11.0));
    vec2 warp = vec2(0.0, eddy * .0017 * poleFade * detail);
    vec2 gdsQ = neptuneDelta(uv, gdsCenter) / gdsSize;
    float gdsRadius = length(gdsQ);
    float outsideGds = smoothstep(1.25, 2.1, gdsRadius);
    vec2 baseUv = neptuneGdsMap(uv, time) + warp * outsideGds;
    vec2 uvA = baseUv - vec2(jet * ages.x * outsideGds, 0.0);
    vec2 uvB = baseUv - vec2(jet * ages.y * outsideGds, 0.0);
    vec3 colour = mix(neptuneMap(image, uvB).rgb, neptuneMap(image, uvA).rgb, blend);

    // Fine clouds form and dissolve over the existing rim; the baked dark core itself
    // is only resampled, never painted a second time. Use the same deformed outline.
    vec2 gdsCloudQ = neptuneDelta(baseUv, gdsCenter) / gdsSize;
    float gdsCloud = neptuneCompanions(gdsCloudQ, time, 4.7);
    colour = mix(colour, vec3(.72, .82, .96), gdsCloud * .24 * detail);

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
    float scooter = exp(-neptuneSquare(scooterDU / .020) - neptuneSquare(scooterDV / .011));
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
      vec2 delta = neptuneDelta(uv, uNeptuneSpot);
      float seed = uNeptuneSeed * 3.71 + 1.4;
      // Use event age for local circulation; a new event never inherits a random
      // global-time phase. Its seed is fixed at birth, not derived from drifting UV.
      float age = progress * ${NEPTUNE_VORTEX_DURATION.toFixed(1)};
      float grow = smoothstep(.02, .48, progress);
      float erode = smoothstep(.58, .94, progress);
      vec2 size = mix(vec2(.019, .013), vec2(.046, .037), grow);
      size *= vec2(1.0 + .22 * erode, 1.0 - .18 * erode);
      float eqSign = sign(.5 - uNeptuneSpot.y);
      vec2 q = delta / size * vec2(1.0, eqSign);
      q = neptuneRotate(q, .10 * sin(age * .19 + seed));
      q.x += (.18 + .10 * sin(age * .23 + seed)) * q.y;
      q.y += .15 * sin(q.x * 2.6 - age * .28 + seed) * smoothstep(.05, .8, abs(q.x));
      q.y *= 1.0 + .16 * tanh(q.x * 1.5);
      float radius = length(q);
      // Differential circulation winds the texture, not the entire silhouette.
      // Mirroring the local latitude reverses circulation in the other hemisphere.
      vec2 rolled = neptuneRotate(q, -age * .23 / (1.0 + radius * radius * .8));
      float billow = neptuneCloud(vec3(rolled * 2.5, seed));
      float small = neptuneNoise(vec3(rolled * 7.0, seed + 8.3));
      float contour = radius + billow * .32 + small * .055;
      float core = smoothstep(.14, .36, progress) * (1.0 - smoothstep(.69, .94, progress));
      float dark = 1.0 - smoothstep(.56, 1.10, contour + erode * .24 * (billow + .4));
      // A westward, equatorward protrusion is inspired by PIA01992. It stretches
      // and breaks away as the vortex decays rather than shrinking as a neat oval.
      float tongueY = q.y - (.21 + .35 * (-q.x - .65) + .13 * billow);
      float tongue = exp(-neptuneSquare(tongueY / (.20 + erode * .10)))
        * smoothstep(-2.15 - erode * .5, -1.05, q.x) * (1.0 - smoothstep(-.75, -.35, q.x));
      dark = max(dark, tongue * (.58 + billow * .28) * smoothstep(.24, .52, progress));
      // A diffuse, blue-grey depression without a hurricane eye or luminous rim.
      // This is RGB morphology, not a spectral retrieval of aerosol composition.
      colour *= 1.0 - dark * core * (.38 + billow * .07) * vec3(.94, 1.0, 1.06);

      float companion = smoothstep(.02, .15, progress) * (1.0 - smoothstep(.78, .99, progress));
      float clouds = neptuneCompanions(q, age, seed);
      colour = mix(colour, vec3(.78, .87, .98), clouds * companion * .53);
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
  material.customProgramCacheKey = () => key + '-neptune-weather-v2';
  material.needsUpdate = true;
}
