// Low-contrast Neptune tracers: zonal methane clouds plus an illustrative dark-spot event.
// The spot longitude and the accelerated rates are demonstration choices, not a forecast.
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
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    return .70 * neptuneNoise(p)
      + .22 * neptuneNoise(p * 2.05 + 4.7) * (1.0 - smoothstep(.22, .85, footprint * 2.05))
      + .08 * neptuneNoise(p * 4.1 - 2.4) * (1.0 - smoothstep(.22, .85, footprint * 4.1));
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

  // A few broad, sheared cloud tracers are easier to follow than uniform noise.
  float zonalTracer(vec3 p, float latitude, float width, float speed, float scale, float seed) {
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float band = exp(-pow((lat - latitude) / width, 2.0));
    float longitude = atan(p.z, -p.x) / 6.2831853;
    vec3 q = vec3((longitude - uNeptuneTime * speed) * scale, lat * scale * .72, seed);
    float broad = neptuneCloud(q + vec3(0.0, 0.0, uNeptuneTime * .018));
    float filament = neptuneNoise(q * vec3(1.8, 2.9, 1.0) + vec3(7.0, seed * 3.0, 1.7));
    return band * smoothstep(-.18, .48, broad + filament * .18);
  }

  vec3 neptuneAtmosphere(sampler2D image, vec2 uv) {
    float time = uNeptuneTime;
    float activity = uNeptuneActivity;
    vec3 sphere = neptuneSphere(uv);
    float lat = asin(clamp(sphere.y, -1.0, 1.0));

    // The base map is nearly longitude-free, so bounded advection is paired with
    // the explicit tracers below. ages.y is the fading sample at both cycle ends.
    float phase = fract(time / 28.0);
    vec2 ages = (vec2(phase, fract(phase + .5)) - .5) * 28.0;
    float blend = .5 - .5 * cos(phase * 6.2831853);
    float jet = .0042 * exp(-pow(lat / .58, 2.0)) - .0015 * sin(abs(lat) * 2.4);
    vec2 warp = vec2(neptuneCloud(sphere * vec3(9.0, 30.0, 9.0)) * .0015,
      neptuneNoise(sphere * vec3(8.0, 24.0, 8.0) + 3.0) * .0008);
    vec3 colour = mix(
      neptuneMap(image, uv + warp - vec2(jet * ages.y, 0.0)).rgb,
      neptuneMap(image, uv + warp - vec2(jet * ages.x, 0.0)).rgb,
      blend);

    float west = zonalTracer(neptuneSphere(uv - vec2(.0025 * time, 0.0)), -.34, .105, .0070, 7.0, 1.3);
    float east = zonalTracer(neptuneSphere(uv - vec2(-.0017 * time, 0.0)), .08, .090, -.0044, 8.0, 4.1);
    float north = zonalTracer(neptuneSphere(uv - vec2(.0010 * time, 0.0)), .43, .075, .0032, 9.0, 8.6);
    float tracers = west * .62 + east * .46 + north * .34;
    float tracerContrast = .045 * (.38 + .62 * uNeptuneDetail);
    colour *= 1.0 + tracers * tracerContrast;

    // A soft southern dark spot and its northern methane-bright companion. The
    // location, size and lifetime are illustrative; they are not current weather.
    vec2 spotCenter = vec2(.49 + .0047 * time, .385);
    vec2 spotDelta = uv - spotCenter;
    spotDelta.x -= floor(spotDelta.x + .5);
    vec2 spotQ = spotDelta / vec2(.078, .040);
    float spotRadius = length(spotQ);
    float spotNoise = neptuneCloud(vec3(spotQ * vec2(3.0, 4.5), time * .035));
    float spot = 1.0 - smoothstep(.42, 1.34, spotRadius + spotNoise * .16);
    float spotLife = .40 + .60 * activity;
    colour *= 1.0 - spot * (.105 + .17 * activity) * spotLife;

    float companion = exp(-pow((spotQ.y - .86) / .34, 2.0))
      * exp(-pow(spotQ.x / 1.38, 2.0));
    float companionTexture = companion * smoothstep(.10, .68,
      neptuneCloud(vec3(spotQ * vec2(7.0, 12.0) - vec2(time * .36, 0.0), time * .06)) + companion * .72);
    float companionAmount = companionTexture * (.11 + .19 * activity) * spotLife;
    colour = mix(colour, vec3(.82, .91, 1.07), companionAmount);

    // Keep limb haze in the diffuse path. Lighting, including the night side,
    // still controls the final brightness; no emission or additive rim is used.
    float mu = abs(dot(normalize(vNeptuneNormal), normalize(vNeptuneView)));
    float haze = 1.0 - exp(-.028 / max(mu, .09));
    float luminance = dot(colour, vec3(.2126, .7152, .0722));
    return mix(colour, vec3(.73, .86, 1.06) * luminance, haze * .38);
  }
`;

export function patchNeptuneWeather(material, uniforms) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : 'standard';
  material.onBeforeCompile = function(shader, renderer) {
    previous?.call(this, shader, renderer);
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
