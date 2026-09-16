import * as THREE from "three";
import simplexSource from "glsl-noise/simplex/3d.glsl?raw";
import { additionalBodies } from "./additional-bodies.js";
import { solarEruptionAxis, volcanicAxis, icePlumeAxis, tritonPlumeAxis, plumeViewDirection } from './feature-anchors.js';
import { createRingOpticalDepthTexture, RING_INNER, RING_OUTER, RING_SURGE_SCALE_RAD } from './ring-optical-depth.js';
import { EARTH_NIGHT_GLSL } from './earth-night.js';
import { RING_PHOTOMETRY_GLSL, RING_DISPLAY_LEVEL, RING_SPOKE_LEVEL } from './ring-photometry.js';
import {marsPolarFrostEdges, marsSolarLongitude} from './mars-seasons.js';
import { ringSystems, ringSystemFor } from './ring-systems.js';
import { createRingScatteringTexture, SCATTERING_ROW_BASE, shippedScatteringTable } from './ring-multiple-scattering.js';

const simplex = simplexSource.replace("#pragma glslify: export(snoise)", "");
const TAU = Math.PI * 2;
const FLOW_PERIOD = 24;

export const activityProfiles = {
  sun: {
    title: "光球对流与磁场活动",
    text: "细密的光球持续变化，日珥沿磁场拱起，耀斑与物质喷发间歇发生。",
    trigger: "模拟喷发",
    idle: "光球对流",
    active: "耀斑与物质喷发",
    duration: 13,
    interval: 34,
  },
  mercury: {
    illumination: true,
    title: "晨昏线与地形明暗",
    text: "日照缓慢掠过古老陨坑，改变坑壁与平原的明暗。短时间内，岩石地表保持稳定。",
    trigger: "观测晨昏线",
    idle: "日照推移",
    active: "晨昏线观测",
    duration: 12,
    interval: 42,
  },
  venus: {
    title: "浓云中的大气环流",
    text: "不同高度的云层交错流动，逐渐拉伸与变形。关闭云层后可见稳定的雷达地表。",
    trigger: "增强云流",
    idle: "高层云流",
    active: "云流增强",
    duration: 16,
    interval: 39,
  },
  earth: {
    title: "云层演变与雷暴",
    text: "云团逐渐聚集、消散，旋涡组织起弯曲云带；雷暴在局部云系中间歇闪现。",
    trigger: "模拟雷暴",
    idle: "云层演变",
    active: "旋涡与雷暴",
    duration: 16,
    interval: 35,
  },
  mars: {
    title: "尘埃输运与沙尘暴",
    text: "近地尘埃随风飘移，局部沙尘逐渐扬起、扩散，再缓慢沉降。",
    trigger: "模拟沙尘暴",
    idle: "尘埃输运",
    active: "局部沙尘暴",
    duration: 19,
    interval: 44,
  },
  jupiter: {
    title: "差速云带与大红斑",
    text: "相邻云带沿不同方向流动，大红斑周围的云纹持续卷入巨大的旋涡。",
    trigger: "增强风暴",
    idle: "云带差速流动",
    active: "风暴增强",
    duration: 17,
    interval: 37,
  },
  saturn: {
    title: "大气环流与光环粒子",
    text: "柔和云带缓慢流动。环中的冰粒沿各自轨道运行，内侧环粒绕行得更快。",
    trigger: "环粒高亮",
    idle: "云流与环粒绕行",
    active: "光环粒子观测",
    duration: 18,
    interval: 43,
  },
  uranus: {
    title: "低对比度的云层变化",
    text: "淡青色的大气中，柔和云纹缓慢演变，局部较亮的云团逐渐形成与消散。",
    trigger: "观测云团",
    idle: "柔和云流",
    active: "局部云团发展",
    duration: 19,
    interval: 46,
  },
  neptune: {
    title: "高速云流与风暴",
    text: "高空云系沿纬度流动，局部旋涡不断改变周围云带的形态。",
    trigger: "增强风暴",
    idle: "高空云系流动",
    active: "局部风暴发展",
    duration: 16,
    interval: 36,
  },
  ...Object.fromEntries(
    additionalBodies.map((body) => [
      body.id,
      {
        title: body.feature,
        text: body.featureText,
        trigger: "观测晨昏线",
        idle: "日照与地形",
        active: "晨昏线观测",
        illumination: true,
        duration: 12,
        interval: 42,
      },
    ]),
  ),
  io: {
    title: "火山热点与喷发物",
    text: "局部熔岩热点明暗变化，喷发物拱起后向周围散落。位置、强度与时间均为现象示意。",
    trigger: "模拟火山",
    idle: "火山热点",
    active: "火山喷发",
    duration: 17,
    interval: 38,
  },
  enceladus: {
    title: "南极裂缝与冰粒喷流",
    text: "冰粒从南极附近向外喷出，形成逐渐扩散的羽流。喷流规模和亮度为演示效果。",
    trigger: "观测喷流",
    idle: "南极冰粒喷流",
    active: "喷流增强",
    duration: 18,
    interval: 40,
  },
  ganymede: {
    title: "极光卵与磁层耦合",
    text: "南北两极各有一圈极光卵，随木星磁层的等离子体扫过而摆动与明暗变化。相位按木星自转推进，幅度为示意。",
    trigger: "观测极光",
    idle: "极光卵",
    active: "极光增强",
    duration: 18,
    interval: 40,
  },
  triton: {
    title: "南极氮气喷流",
    text: "氮气从南极附近喷出约 8 km 高，随气流横向弯曲。旅行者 2 号 1989 年观测到这些喷流，本项目按同一机制重建，位置与强度为示意，不表示当前正在喷发。",
    trigger: "观测喷流",
    idle: "南极氮气喷流",
    active: "喷流增强",
    duration: 20,
    interval: 44,
  },
  titan: {
    title: "雾霾与高层大气",
    text: "橙色雾霾缓慢流动，高空云纹逐渐聚散。当前展示雾霾外观示意，地表被大气遮挡。",
    trigger: "增强云流",
    idle: "高空雾霾",
    active: "云纹聚散",
    duration: 18,
    interval: 43,
  },
};

const common = /* glsl */ `
  ${EARTH_NIGHT_GLSL}
  uniform float uActivityTime;
  uniform float uActivityEnabled;
  uniform float uActivityDetail;
  uniform float uActivityEvent;
  uniform float uActivityProgress;
  uniform float uFlowPhase;
  uniform vec3 uWeatherOffset;
  uniform vec3 uSurfaceSun;
  uniform vec3 uRingSun;
  // Declared for every patched material; only the Mars and Ganymede globes assign them.
  uniform float uMarsFrostNorth;
  uniform float uMarsFrostSouth;
  uniform float uGanymedeAurora;
  uniform float uGanymedeOvalShift;
  uniform mat3 uSurfaceToCloud;
  uniform sampler2D uCloudTexture;
  uniform sampler2D uObservedCloudPrevious;
  uniform sampler2D uObservedCloudNext;
  uniform float uObservedClouds;
  uniform float uObservedCloudAvailable;
  uniform float uObservedCloudBlend;
  uniform sampler2D uNightTexture;
  uniform sampler2D uRingOpticalDepth;
  uniform sampler2D uRingScattering;
  uniform float uRingScatteringRow;
  uniform float uRingScatteringRows;
  uniform vec2 uRingSpan;
  uniform vec3 uRingCamera;
  uniform float uRingPhaseG;
  uniform float uRingSurgeScale;
  ${RING_PHOTOMETRY_GLSL}
  uniform float uCloudAvailable;
  uniform float uCloudVisible;
  uniform float uNightEnabled;
  uniform float uShadowEnabled;
  // Polar/equatorial semi-axis ratio, 1 for a round body. Shadows and occlusions here
  // are measured in units of the equatorial radius, which is the unit the globe and the
  // ring geometry are both built in, so the scene's own radius scale never enters.
  uniform float uBodyPolarRatio;
  uniform float uSunAngularRadius;
  varying vec3 vActivityDir;
  varying vec2 vActivityUv;
  varying vec3 vActivityPosition;
  ${simplex}
  float weatherNoise(vec3 p) {
    return .64 * snoise(p) + .27 * snoise(p * 2.03 + 7.1)
      + .09 * snoise(p * 4.07 - 2.3);
  }
  vec4 sampleGlobe(sampler2D image, vec2 uv) {
    // Keep longitude continuous for filtering; the sampler handles wrapping.
    uv.y = clamp(uv.y, .002, .998);
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    // Sun-projected cloud coordinates can cross atan's longitude seam.
    dx.x -= floor(dx.x + .5);
    dy.x -= floor(dy.x + .5);
    return textureGrad(image, uv, dx, dy);
  }
  vec3 flowCycle() {
    // The resetting sample has zero weight and zero weight derivative.
    return vec3((vec2(uFlowPhase, fract(uFlowPhase + .5)) - .5) * ${FLOW_PERIOD.toFixed(1)},
      .5 - .5 * cos(uFlowPhase * 6.2831853));
  }
  vec2 vortexUv(vec2 p, vec2 center, vec2 size, float angle) {
    vec2 d = p - center;
    d.x = fract(d.x + .5) - .5;
    vec2 q = d / size;
    float r = length(q);
    float a = angle * (1.0 - smoothstep(.3, 1.6, r));
    q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
    return p + q * size - d;
  }
  float stormCloud(vec2 uv, vec2 center, float time) {
    vec2 d = uv - center;
    d.x = fract(d.x + .5) - .5;
    d *= vec2(2.0, 1.0);
    vec2 q = d / .046;
    float r = length(q);
    float bend = 2.4 * exp(-r * .85) - time * .20;
    vec2 flow = mat2(cos(bend), -sin(bend), sin(bend), cos(bend)) * q;
    float billow = weatherNoise(vec3(flow * 3.0 + vec2(17.0,9.0), time * .035));
    float fine = snoise(vec3(flow * 11.0 + vec2(3.0,4.0), time * .06));
    float arms = .5 + .5 * sin(atan(q.y,q.x) * 2.0 + r * 5.0 - time * .4 + billow * .85);
    float edge = 1.0 - smoothstep(.55, 1.28, r + billow * .12);
    float eye = smoothstep(.06, .17, r);
    return smoothstep(-.20, .50, arms * .28 + billow * .7 + fine * .18)
      * edge * eye;
  }
  vec2 directionUv(vec3 p) {
    p = normalize(p);
    return vec2(fract(atan(p.z,-p.x) / 6.2831853 + 1.0), .5 + asin(clamp(p.y,-1.0,1.0)) / 3.14159265);
  }
  float earthCloudDensity(vec2 uv, vec3 direction) {
    if (uObservedClouds > .5) {
      if (uObservedCloudAvailable < .5) return 0.0;
      vec4 previous = sampleGlobe(uObservedCloudPrevious, uv);
      vec4 next = sampleGlobe(uObservedCloudNext, uv);
      float blend = smoothstep(0.0, 1.0, uObservedCloudBlend);
      return mix(previous.g * previous.a, next.g * next.a, blend);
    }
    float a = uActivityEnabled * uActivityDetail;
    float t = uActivityTime;
    vec3 cloudP = direction * 13.0;
    float evolving = weatherNoise(cloudP + uWeatherOffset);
    if (uCloudAvailable < .5) return smoothstep(.18,.65,evolving) * .4;
    vec2 cloudUv = uv;
    cloudUv += a * vec2(evolving, snoise(cloudP * 1.7 - uWeatherOffset)) * .003;
    vec3 cycle = flowCycle();
    vec2 wind = vec2(a * sin(uv.y * 14.0) * .0017, 0.0);
    float mapped = mix(sampleGlobe(uCloudTexture, cloudUv + wind * cycle.y).g,
      sampleGlobe(uCloudTexture, cloudUv + wind * cycle.x).g, cycle.z);
    float vapor = smoothstep(.05,.80,mapped + a * evolving * .15);
    vapor = max(vapor, stormCloud(uv,vec2(.773,.45),t) * a * (.24 + uActivityEvent * .74));
    return mix(mapped,vapor,a);
  }
  float sphereShadow(vec3 p, vec3 sunDirection) {
    float along = dot(p,sunDirection);
    float closest = sqrt(max(dot(p,p) - along * along,0.0));
    return along < 0.0 ? smoothstep(.982,1.018,closest) : 1.0;
  }
`;

function patchMaterial(material, key, uniforms, snippets) {
  material.onBeforeCompile = (shader) => {
    const ringSurface = key === "ring-surface";
    const saturnShadow = key === "saturn" || key === "saturn-rings" || ringSurface;
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vActivityDir; varying vec2 vActivityUv; varying vec3 vActivityPosition;" +
          (saturnShadow ? "\nvarying mat3 vActivityViewToLocal;" : "") +
          (ringSurface ? "\nattribute vec4 aRingProfile; attribute float aRingRegion; attribute float aRingEdge; attribute float aRingHalfWidth; attribute float aRingRoom;"
            + "\nuniform float uRingPixelScale;\nvarying vec4 vRingProfile; varying float vRingRegion; varying float vRingCoverage;"
            + `\n#define RING_MIN_PIXELS ${RING_MIN_PIXELS.toFixed(1)}` : ""),
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvActivityDir = normalize(position); vActivityUv = uv; vActivityPosition = position;" +
          (saturnShadow ? "\nvActivityViewToLocal = transpose(mat3(modelViewMatrix));" : "") +
          (ringSurface ? /* glsl */ `
            vRingProfile = aRingProfile; vRingRegion = aRingRegion;
            {
              // Screen size of one pixel in the body's own units. projectionMatrix[1][1]
              // is 1/tan(fov/2) and uRingPixelScale is the viewport height in device
              // pixels, so the widening needs no camera uniform of its own.
              float ringBodyScale = max(length(modelMatrix[0].xyz), .000001);
              vec4 ringView = modelViewMatrix * vec4(position, 1.0);
              float ringPixel = 2.0 * max(-ringView.z, .0001)
                / (uRingPixelScale * projectionMatrix[1][1] * ringBodyScale);
              float ringWiden = max(0.0, RING_MIN_PIXELS * ringPixel * 0.5 - aRingHalfWidth);
              // Only into the gap beside this edge. Two annuli that abut would otherwise
              // overlap once widened, and overlapping translucent strips composite to less
              // light than their sum, which dims the whole band rather than one ring.
              ringWiden = min(ringWiden, aRingRoom);
              vec2 ringOutward = normalize(position.xy + vec2(.000001, 0.0));
              transformed = position + vec3(ringOutward * ringWiden * aRingEdge, 0.0);
              vRingCoverage = aRingHalfWidth / (aRingHalfWidth + ringWiden);
            }
          ` : ""),
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\n${common}${ringSurface ? ringSurfaceVaryings : ""}${saturnShadow ? saturnShadowFunctions : ""}`,
    );
    for (const [chunk, source] of Object.entries(snippets)) {
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <${chunk}>`,
        source,
      );
    }
  };
  material.customProgramCacheKey = () => `solar-activity-v1-${key}`;
  material.needsUpdate = true;
}

function gasMap(id) {
  const settings = {
    titan: {
      bands: 5,
      drift: 0.0012,
      warp: 0.002,
      center: [".22", ".65"],
      size: [".16", ".12"],
      swirl: 0.02,
      cloud: 0.07,
    },
    venus: {
      bands: 6,
      drift: 0.0038,
      warp: 0.007,
      center: [".22", ".55"],
      size: [".12", ".10"],
      swirl: 0.04,
      cloud: 0.15,
    },
    jupiter: {
      bands: 28,
      drift: 0.0014,
      warp: 0.002,
      center: [".365", ".39"],
      size: [".044", ".040"],
      swirl: 0.085,
      cloud: 0.045,
    },
    saturn: {
      bands: 34,
      drift: 0.001,
      warp: 0.001,
      center: [".20", ".64"],
      size: [".06", ".04"],
      swirl: 0.06,
      cloud: 0.04,
    },
    uranus: {
      bands: 14,
      drift: 0.0015,
      warp: 0.001,
      center: [".24", ".54"],
      size: [".07", ".05"],
      swirl: 0.08,
      cloud: 0.055,
    },
    neptune: {
      bands: 20,
      drift: 0.0024,
      warp: 0.002,
      center: [".23", ".42"],
      size: [".065", ".055"],
      swirl: 0.1,
      cloud: 0.065,
    },
  }[id];
  const num = (value) => value.toFixed(5);
  return /* glsl */ `
    #ifdef USE_MAP
      vec2 flowUv = vMapUv;
      float flowAmount = uActivityEnabled * uActivityDetail;
      float poleFade = pow(max(sin(flowUv.y * 3.14159265), 0.0), 2.0);
      float latitude = flowUv.y * 3.14159265;
      float jet = sin(latitude * ${num(settings.bands)}) + .3 * sin(latitude * 47.0);
      vec2 stormCenter = vec2(${settings.center.join(",")});
      vec2 stormDelta = flowUv - stormCenter;
      stormDelta.x -= floor(stormDelta.x + .5);
      float stormDistance = length(stormDelta / vec2(${settings.size.join(",")}));
      float stormMask = 1.0 - smoothstep(.7, 1.8, stormDistance);
      float turbulence = weatherNoise(vActivityDir * vec3(4.0,32.0,4.0) + uWeatherOffset);
      vec3 cycle = flowCycle();
      vec2 wind = vec2(flowAmount * ${num(settings.drift)} * jet * poleFade * (1.0 - stormMask), 0.0);
      flowUv.y += flowAmount * ${num(settings.warp)} * turbulence * poleFade;
      float swirl = flowAmount * ${num(settings.swirl)} * (1.0 + uActivityEvent * .35);
      vec2 uvA = vortexUv(flowUv + wind * cycle.x, stormCenter,
        vec2(${settings.size.join(",")}), cycle.x * swirl);
      vec2 uvB = vortexUv(flowUv + wind * cycle.y, stormCenter,
        vec2(${settings.size.join(",")}), cycle.y * swirl);
      vec4 gasColor = mix(sampleGlobe(map, uvB), sampleGlobe(map, uvA), cycle.z);
      float movingCloud = smoothstep(-.10, .60, turbulence);
      gasColor.rgb += vec3(${num(settings.cloud)}) * flowAmount * movingCloud
        * (.25 + uActivityEvent * .75) * (.24 + stormMask * .76);
      ${id === "neptune" ? "gasColor.rgb *= 1.0 - stormMask * uActivityEvent * .24;" : ""}
      ${id === 'saturn' ? `
        // A sourced polar shape with illustrative cloud detail, not dated imagery.
        vec3 polar = normalize(vActivityDir);
        float sector = mod(atan(polar.z, polar.x) + .5235988, 1.0471976) - .5235988;
        float hexRadius = length(polar.xz) * cos(sector);
        float north = smoothstep(.96, .975, polar.y);
        float hexEdge = exp(-pow((hexRadius - .180) / .007, 2.0)) * north;
        float hexInterior = (1.0 - smoothstep(.168, .184, hexRadius)) * north;
        gasColor.rgb = mix(gasColor.rgb, gasColor.rgb * vec3(.72, .83, .83), hexInterior * .55);
        gasColor.rgb *= 1.0 - hexEdge * .28;
        gasColor.rgb *= 1.0 - exp(-dot(polar.xz, polar.xz) / .00022) * north * .45;
      ` : ''}
      diffuseColor *= gasColor;
    #endif
  `;
}

function attachSolarSurface(record) {
  patchMaterial(record.body.mesh.material, "sun", record.uniforms, {
    map_fragment: /* glsl */ `
      #ifdef USE_MAP
        float a = uActivityEnabled * (.25 + .75 * uActivityDetail);
        vec3 p = vActivityDir * 37.0;
        float boil = snoise(p + vec3(uActivityTime * .21, 0.0, uActivityTime * .12));
        float fine = snoise(p * 3.4 + vec3(0.0, uActivityTime * .40, 0.0));
        vec2 solarUv = vMapUv + a * vec2(boil, fine) * .0027;
        vec4 solarColor = sampleGlobe(map, solarUv);
        solarColor.rgb *= 1.0 + a * (boil * .22 + fine * .14);
        float flare = pow(max(dot(vActivityDir, normalize(vec3(.88,.32,.26))), 0.0), 105.0);
        solarColor.rgb += vec3(1.0,.34,.045) * flare * uActivityEvent * a * .30;
        diffuseColor *= solarColor;
      #endif
    `,
  });
}

function attachEarthClouds(record) {
  record.body.clouds.material.opacity = 0.9;
  patchMaterial(record.body.clouds.material, "earth-clouds", record.uniforms, {
    map_fragment: "diffuseColor.rgb *= vec3(.98, .99, 1.0);",
    alphamap_fragment: /* glsl */ `
      diffuseColor.a *= earthCloudDensity(vActivityUv,normalize(vActivityDir));
    `,
    emissivemap_fragment: /* glsl */ `
      #include <emissivemap_fragment>
      vec2 thunderDelta = (vActivityUv - vec2(.785,.458)) * vec2(2.0,1.0);
      float thunderArea = exp(-dot(thunderDelta,thunderDelta) * 3700.0);
      float flash = pow(max(sin(uActivityTime * 4.7),0.0), 18.0);
      totalEmissiveRadiance += vec3(.48,.65,1.0) * thunderArea * flash
        * uActivityEvent * uActivityDetail * uActivityEnabled * (1.0 - uObservedClouds) * 1.3;
    `,
  });
}

function attachEarthSurface(record) {
  patchMaterial(record.body.mesh.material, "earth-surface", record.uniforms, {
    emissivemap_fragment: /* glsl */ `
      #include <emissivemap_fragment>
      // The terminator band, the city threshold and the brightness are shared with the
      // landing sky, which draws the same Earth from further away.
      totalEmissiveRadiance += earthNightLights(texture2D(uNightTexture,vActivityUv).rgb,
        earthNightFactor(vActivityDir,uSurfaceSun),uNightEnabled);
    `,
    lights_fragment_end: /* glsl */ `
      #include <lights_fragment_end>
      vec3 ground = normalize(vActivityDir);
      // Intersect the sunward ray with the rotating cloud shell.
      float sunDot = dot(ground,uSurfaceSun);
      float travel = -sunDot + sqrt(sunDot * sunDot + 1.012 * 1.012 - 1.0);
      vec3 cloudDirection = normalize(uSurfaceToCloud * (ground + uSurfaceSun * travel));
      float density = earthCloudDensity(directionUv(cloudDirection),cloudDirection);
      float transmission = 1.0 - density * .64 * uCloudVisible * uShadowEnabled;
      reflectedLight.directDiffuse *= transmission;
      reflectedLight.directSpecular *= transmission;
    `,
  });
}

const saturnShadowFunctions = /* glsl */ `
  varying mat3 vActivityViewToLocal;
  float ringOpticalDepth(float radiusUv, float footprint) {
    float edge = max(footprint, .001);
    float mask = smoothstep(-edge, edge, radiusUv)
      * (1.0 - smoothstep(1.0-edge, 1.0+edge, radiusUv));
    return textureGrad(uRingOpticalDepth, vec2(clamp(radiusUv,0.0,1.0),.5),
      vec2(footprint,0.0), vec2(0.0)).r * mask;
  }
  float ringSurgeAmplitude(float radiusUv) {
    return texture2D(uRingOpticalDepth, vec2(clamp(radiusUv,0.0,1.0),.5)).b;
  }
  // Transmission through a particle slab: exp(-tau/mu), with mu the cosine between
  // the ray and the ring normal. Grazing rays cross more material, so the ring goes
  // opaque near the ring-plane crossings instead of keeping its face-on opacity.
  float ringRayTransmission(vec3 p, vec3 lightDirection, float angularWidth) {
    float safeY = (lightDirection.y < 0.0 ? -1.0 : 1.0) * max(abs(lightDirection.y),.0001);
    float travel = -p.y / safeY;
    vec2 intersection = (p + lightDirection * travel).xz;
    float ringRadius = length(intersection);
    float span = max(uRingSpan.y - uRingSpan.x, .0001);
    float ringUv = (ringRadius - uRingSpan.x) / span;
    float radialDerivative = abs(dot(intersection, lightDirection.xz))
      / max(ringRadius * length(lightDirection.xz), .0001);
    float sourceFootprint = abs(p.y) * radialDerivative * angularWidth / (safeY * safeY * span);
    float footprint = clamp(max(fwidth(ringUv), sourceFootprint), .001, .5);
    float tau = ringOpticalDepth(ringUv, footprint);
    // |lightDirection.y| is the cosine between the ray and the ring normal.
    float mu = clamp(abs(lightDirection.y), .001, 1.0);
    return travel > .0001 ? exp(-tau / mu) : 1.0;
  }
  float ringTransmission(vec3 p, vec3 lightDirection) {
    if (uShadowEnabled < .5) return 1.0;
    // Integrate strips of the solar disk, including rays crossing either side of the ring plane.
    vec3 horizontal = normalize(vec3(lightDirection.x, 0.0, lightDirection.z) + vec3(.000001,0.0,0.0));
    float elevation = asin(clamp(lightDirection.y, -1.0, 1.0));
    // Average the transmission over the solar disk. Averaging opacity instead would
    // need a different curve for every geometry, since exp is not linear.
    float transmission = 0.0, totalWeight = 0.0;
    for (int i = 0; i < 9; i++) {
      float offset = (float(i) - 4.0) / 4.5;
      float weight = sqrt(1.0 - offset * offset);
      float angle = elevation + offset * uSunAngularRadius;
      vec3 direction = horizontal * cos(angle) + vec3(0.0, sin(angle), 0.0);
      transmission += ringRayTransmission(p, direction, uSunAngularRadius / 4.5) * weight;
      totalWeight += weight;
    }
    return transmission / totalWeight;
  }
  // p and lightDirection are both in the ring mesh's own frame, in units of the
  // equatorial radius, where the ring plane is z = 0 and the polar axis is +Z. Dividing
  // the polar component by the polar ratio takes that frame to the one where the
  // ellipsoid is a unit sphere: the ring plane is unchanged, and a ray stays a ray
  // because the map is linear. Measuring against a unit sphere without it leaves the
  // shadow too wide; the ratio is 1 for every round body, and the caller must scale the
  // point and the light the same way or they end up in different spaces.
  float planetTransmission(vec3 p, vec3 lightDirection) {
    vec3 light = vec3(lightDirection.x, lightDirection.y, lightDirection.z / uBodyPolarRatio);
    vec3 point = vec3(p.x, p.y, p.z / uBodyPolarRatio);
    float lightLength = length(light);
    float along = dot(point,light) / lightLength;
    float closest = length(cross(point,light)) / lightLength;
    float feather = max(fwidth(closest) * 1.5,
      .001 + max(-along,0.0) * tan(uSunAngularRadius));
    float visibility = along < 0.0 ? smoothstep(1.0-feather,1.0+feather,closest) : 1.0;
    return mix(1.0,visibility,uShadowEnabled);
  }
`;

// Ring region data, supplied per vertex by the ring system geometry. Declared only for
// the ring surface material, because a fragment varying with no matching vertex
// declaration fails program validation on every other material that shares `common`.
const ringSurfaceVaryings = /* glsl */ `
  varying vec4 vRingProfile;
  varying float vRingRegion;
  // Fraction of the drawn band that is the ring itself. A ring narrower than a pixel is
  // drawn widened so the rasteriser always finds it, and its opacity is scaled by this
  // fraction so the light it contributes is unchanged.
  varying float vRingCoverage;
`;

// Minimum screen width an annulus is drawn at, in device pixels.
//
// A ring drawn at its measured width is thinner than a pixel once you are far enough
// away: Uranus's rings are 1.6 to 58 km against roughly 100 km per pixel at the framing
// this was reported from, so every one of them lands between 0.02 and 0.6 of a pixel. At
// that size the rasteriser's fixed sample positions catch a ribbon on some pixels and
// miss it on others, and a ring that should read as a faint continuous line reads as
// scattered specks instead. Widening the band to a pixel and a half makes the coverage
// deterministic, and dividing the opacity by the same factor keeps the total light
// correct, so the ring appears as the faint line it is.
//
// This is antialiasing, not a visibility boost. Nothing is brightened: a ring covering a
// thousandth of a pixel still contributes a thousandth of a pixel of light, it just
// contributes it along the whole line instead of at scattered points.
const RING_MIN_PIXELS = 1.5;


function saturnDirectLighting(transmission, scatter = false) {
  // Apply occlusion to incident light before accumulating direct illumination.
  // Ring particles also scatter across the plane, unlike an opaque Lambert surface.
  return THREE.ShaderChunk.lights_fragment_begin.replaceAll(
    "RE_Direct( directLight,",
    `directLight.color *= ${transmission};\n${scatter ? "reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * .05;\n" : ""}RE_Direct( directLight,`,
  );
}

function attachRingSurface(record) {
  patchMaterial(record.body.ring.material, "ring-surface", record.uniforms, {
    // Opacity and reflectance both read the region the fragment belongs to, carried
    // as a vertex attribute from the ring geometry, so a gap that lets sunlight
    // through also lets the background through and cannot disagree with the region
    // whose optical depth it is using. The Lambert result is thrown away and replaced
    // by the slab term: a ring particle layer is not an opaque surface, and treating
    // it as one is what forced the old display contrast boost. The base colour no
    // longer comes from the ring texture: that image's RGB varies with radius but not
    // with any measured property, so it is not sampled here.
    map_fragment: /* glsl */ `
      vec3 ringSunLocal = normalize(uRingSun);
      vec3 ringViewLocal = normalize(uRingCamera - vActivityPosition);
      float ringMu0 = clamp(abs(ringSunLocal.z), .001, 1.0);
      float ringMu = clamp(abs(ringViewLocal.z), .001, 1.0);
      float ringTau = vRingProfile.r;
      float ringAlbedoW = vRingProfile.g;
      float ringSurge = vRingProfile.b;
      vec3 ringColour = ringParticleColour(vRingProfile.a);
      float ringCosAlpha = dot(ringSunLocal, ringViewLocal);
      diffuseColor.a = (1.0 - exp(-ringTau / ringMu)) * vRingCoverage;
    `,
    lights_fragment_end: /* glsl */ `
      #include <lights_fragment_end>
      #define RING_DISPLAY_LEVEL ${RING_DISPLAY_LEVEL.toFixed(2)}
      #define RING_SPOKE_LEVEL ${RING_SPOKE_LEVEL.toFixed(2)}
      // Overwrite the Lambert result rather than replacing the lighting chunks: the
      // surrounding chunks declare variables that later stages still read.
      // The planet's shadow on the rings. vActivityPosition is the annulus's true
      // position, not the widened one the rasteriser was given, so the shadow edge stays
      // on the measured radius. It is already in units of the equatorial radius, which is
      // how the ring geometry is built and how the planet's own shader hands its surface
      // point to ringTransmission, so dividing it by uBodyRadius was shrinking every ring
      // point to a fraction of the planet and growing the shadow into the whole
      // anti-sunward half of the ring system.
      float ringOcclusion = mix(
        1.0, planetTransmission(vActivityPosition, ringSunLocal), uShadowEnabled);
      // The two faces of the ring are not the same surface. The side the sun is on
      // reflects sunlight off its particles; the other side is only lit by what crossed
      // the slab, which is why the unlit face of an optically thick ring reads as nearly
      // black while the thin C ring stays legible through it. Which face the camera is on
      // is the product of the two cosines from the ring normal: positive means the sun and
      // the camera are on the same side.
      float ringFacing = ringSunLocal.z * ringViewLocal.z;
      // Spokes. Dark radial markings, seen on the B ring, reported mainly near ring-plane equinox and
      // gathered in patches that come and go over hours to days. Their drift does not follow the ring
      // material and is still not explained, so the two things this does keep are the ones the
      // observations establish: the season (grazing sun elevation) and the radial band (the measured B
      // ring span, in units of the equatorial radius). How many there are and where in azimuth they
      // fall is a display choice, marked as such: spreading them around the ring keeps the effect
      // visible from any framing, which a few narrow wedges at one azimuth do not.
      float spokeRadius = length(vActivityPosition.xy);
      float spokeBand = smoothstep(1.526, 1.560, spokeRadius) * (1.0 - smoothstep(1.915, 1.951, spokeRadius));
      float spokeSeason = 1.0 - smoothstep(.05, .35, abs(ringSunLocal.z));
      float spokeAzimuth = atan(vActivityPosition.y, vActivityPosition.x);
      float spokePattern = 0.0;
      for (int i = 0; i < 8; i++) {
        float spacing = 6.2831853 / 8.0;
        float offset = float(i) * spacing + sin(float(i) * 12.9898) * .21;
        float width = .030 + .022 * (.5 + .5 * sin(float(i) * 7.233));
        float delta = atan(sin(spokeAzimuth - offset), cos(spokeAzimuth - offset));
        spokePattern = max(spokePattern, 1.0 - smoothstep(width * .45, width, abs(delta)));
      }
      float spoke = spokePattern * spokeBand * spokeSeason * RING_SPOKE_LEVEL;
      float ringRadiance = ringFacing > 0.0
        ? ringSlabReflectance(ringTau, ringAlbedoW, ringMu, ringMu0, ringCosAlpha, vRingRegion, uRingPhaseG)
          // The opposition surge was fitted to the ring's reflected I/F; there is no
          // measured surge in transmission, and the coherent forward peak is not modelled.
          * ringOppositionSurge(ringCosAlpha, ringSurge)
        : ringSlabTransmittance(ringTau, ringAlbedoW, ringMu, ringMu0, ringCosAlpha, vRingRegion, uRingPhaseG);
      ringRadiance *= ringOcclusion * RING_DISPLAY_LEVEL * (1.0 - spoke);
      reflectedLight.directDiffuse = ringColour * ringRadiance;
      reflectedLight.directSpecular = vec3(0.0);
      reflectedLight.indirectDiffuse = vec3(0.0);
      reflectedLight.indirectSpecular = vec3(0.0);
    `,
  });
}

// Ganymede's auroral ovals. Hubble found two ovals that rock back and forth as Jupiter's
// magnetosphere sweeps past, and brighten when the sub-Jovian longitude points the plasma sheet at
// the moon. The phase here follows Jupiter's System III rotation, which is the driver; the amplitude
// and the oval's latitude are taken from the observed order of magnitude and are a display
// approximation, not a replay of any particular observation. The ovals emit rather than reflect, so
// they are added to the lit result instead of multiplied into it.
const GANYMEDE_AURORA_PERIOD_SECONDS = 9.925 * 3600;
function attachGanymedeAurora(record) {
  // The overview objects name the sphere `mesh`; `globe` is the landing sky's name for its own.
  if (!record.body.mesh?.material) return;
  record.uniforms.uGanymedeAurora = {value: 0};
  record.uniforms.uGanymedeOvalShift = {value: 0};
  patchMaterial(record.body.mesh.material, "ganymede-aurora", record.uniforms, {
    lights_fragment_end: /* glsl */ `
      #include <lights_fragment_end>
      float ganymedeLatitude = abs((vActivityUv.y - .5) * 180.0) + uGanymedeOvalShift;
      float ganymedeOval = smoothstep(62.0, 68.0, ganymedeLatitude) * (1.0 - smoothstep(76.0, 84.0, ganymedeLatitude));
      reflectedLight.directDiffuse += vec3(.42, .58, 1.0) * ganymedeOval * uGanymedeAurora;
    `,
  });
}

// Mars's seasonal caps: the extent is measured against the planet's own season, the shading is a
// display approximation (see mars-seasons.js). The residual water-ice remnant means the north edge
// never reaches the pole-to-80N extreme the south one does.
function attachMarsFrost(record) {
  if (!record.body.mesh?.material) return;
  record.uniforms.uMarsFrostNorth = {value: 80};
  record.uniforms.uMarsFrostSouth = {value: -87};
  patchMaterial(record.body.mesh.material, "mars-frost", record.uniforms, {
    map_fragment: /* glsl */ `
      float marsLatitude = (vActivityUv.y - .5) * 180.0;
      float marsNorthFrost = smoothstep(uMarsFrostNorth - 6.0, uMarsFrostNorth + 2.0, marsLatitude);
      float marsSouthFrost = 1.0 - smoothstep(uMarsFrostSouth - 2.0, uMarsFrostSouth + 6.0, marsLatitude);
      float marsFrost = max(marsNorthFrost, marsSouthFrost);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.93, .95, .97), marsFrost * .8);
    `,
  });
}

function attachDust(record) {
  const material = new THREE.MeshStandardMaterial({
    color: "#b98758",
    roughness: 1,
    transparent: true,
    depthWrite: false,
    opacity: 1,
  });
  patchMaterial(material, "mars-dust", record.uniforms, {
    alphamap_fragment: /* glsl */ `
      float dustNoise = weatherNoise(vActivityDir * 12.0 + vec3(uActivityTime * .065, 0.0, uActivityTime * .02));
      float fineDust = snoise(vActivityDir * 58.0 + uActivityTime * .08);
      vec2 dustDelta = (vActivityUv - vec2(.225 + .015 * sin(uActivityTime * .05), .46)) * vec2(2.0,1.0);
      float dustFront = exp(-dot(dustDelta,dustDelta) * 28.0);
      float dust = smoothstep(-.08,.65,dustNoise + fineDust * .15);
      diffuseColor.a *= dust * (.12 + dustFront * uActivityEvent * .75)
        * uActivityEnabled * uActivityDetail;
    `,
  });
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1.012, 80, 56),
    material,
  );
  record.body.mesh.add(shell);
  record.extras.push(shell);
}

function makeRandom(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function createProminences(record) {
  const random = makeRandom(4571);
  const group = new THREE.Group();
  const vertexShader = /* glsl */ `
    uniform float uActivityTime;
    uniform float uActivityEvent;
    uniform float uPlumePhase;
    uniform float uPlumeWidth;
    attribute vec3 aTangent;
    varying vec2 vArc;
    varying float vLife;
    ${simplex}
    void main() {
      vArc = uv;
      vLife = .28 + .72 * smoothstep(-.8, .85, sin(uActivityTime * .14 + uPlumePhase));
      vec3 p = position;
      float arch = pow(max(sin(uv.x * 3.14159265), 0.0), .8);
      float eddy = snoise(p * 11.0 + vec3(uPlumePhase, uActivityTime * .16, 0.0));
      p += normalize(p) * arch * (eddy * .014 + (vLife - .5) * .045 + uActivityEvent * .03);
      vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
      vec2 tangent = (modelViewMatrix * vec4(aTangent, 0.0)).xy;
      vec2 side = vec2(-tangent.y, tangent.x) / max(length(tangent), .0001);
      float width = uPlumeWidth * (.35 + arch * .65) * (.85 + eddy * .25);
      // A soft camera-facing strip keeps its volume when viewed edge-on.
      viewPosition.xy += side * (uv.y - .5) * width * length(modelMatrix[0].xyz);
      gl_Position = projectionMatrix * viewPosition;
    }
  `;
  const fragmentShader = /* glsl */ `
    uniform float uActivityTime;
    uniform float uActivityEvent;
    uniform float uPlumePhase;
    varying vec2 vArc;
    varying float vLife;
    ${simplex}
    void main() {
      float t = uActivityTime;
      vec3 p = vec3(vArc.x * 8.0 - t * .18, vArc.y * 3.0, uPlumePhase + t * .08);
      float billow = snoise(p) + .35 * snoise(p * 2.7);
      float across = (vArc.y - .5) * 2.0;
      float spine = .19 * sin(vArc.x * 17.0 - t * .6 + uPlumePhase) + billow * .13;
      float radial = (across - spine) * 1.9;
      float veil = exp(-radial * radial);
      float strands = .5 + .5 * snoise(vec3(vArc.x * 19.0 - t * .7,
        across * 13.0 + billow * 2.0, uPlumePhase));
      float wisps = smoothstep(-.25, .75, billow);
      float density = veil * (.035 + wisps * .965) * (.35 + strands * .65);
      float edge = 1.0 - smoothstep(.65, 1.0, abs(across));
      float feet = smoothstep(0.0, .055, vArc.x) * (1.0 - smoothstep(.945, 1.0, vArc.x));
      vec3 color = mix(vec3(.95,.045,.003), vec3(1.0,.36,.035), strands * wisps);
      gl_FragColor = vec4(color, density * edge * feet * (vLife * 1.15 + uActivityEvent * .16));
      #include <colorspace_fragment>
    }
  `;
  const regions = [0.38, 1.24, 1.85, 3.42, 4.36, 5.42];
  for (const [index, region] of regions.entries()) {
    const angle = region + (random() - 0.5) * 0.13;
    const normal = new THREE.Vector3(
      Math.cos(angle),
      Math.sin(angle) * 0.8,
      (random() - 0.4) * 0.55,
    ).normalize();
    const tangent = new THREE.Vector3()
      .crossVectors(normal, new THREE.Vector3(0, 0, 1))
      .normalize();
    const binormal = new THREE.Vector3().crossVectors(normal, tangent);
    const spread = 0.08 + random() * 0.075;
    const archHeight = 0.075 + random() * 0.17;
    const phase = index * 1.73 + random();
    const points = [];
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI;
      const arch = Math.pow(Math.sin(t), 0.9);
      const foot =
        spread * Math.cos(t) + Math.sin(t) * Math.sin(t * 2 + phase) * 0.035;
      points.push(
        normal
          .clone()
          .multiplyScalar(Math.cos(foot))
          .addScaledVector(tangent, Math.sin(foot))
          .multiplyScalar(
            0.995 + archHeight * arch * (0.86 + 0.14 * Math.sin(t * 3 + phase)),
          )
          .addScaledVector(binormal, arch * Math.sin(t * 2 + phase) * 0.032),
      );
    }
    const curve = new THREE.CatmullRomCurve3(points);
    if (index === 0) record.prominenceAnchor = { point: curve.getPointAt(.5), phase };
    const positions = [],
      tangents = [],
      uvs = [],
      indices = [];
    const segments = 96;
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const point = curve.getPointAt(u);
      const tangentAt = curve.getTangentAt(u);
      for (const side of [0, 1]) {
        positions.push(...point);
        tangents.push(...tangentAt);
        uvs.push(u, side);
      }
      if (i < segments) {
        const v = i * 2;
        indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "aTangent",
      new THREE.Float32BufferAttribute(tangents, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...record.uniforms,
        uPlumePhase: { value: phase },
        uPlumeWidth: { value: 0.15 + random() * 0.065 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const plume = new THREE.Mesh(geometry, material);
    plume.frustumCulled = false;
    group.add(plume);
  }
  record.body.mesh.add(group);
  record.extras.push(group);
}

function createParticles(record, kind) {
  const count = kind === "rings" ? 6500 : kind === "solar" ? 1800 : 1400;
  const random = makeRandom(kind === "rings" ? 5129 : 9387);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
  );
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  let positionCode;
  if (kind === "rings") {
    positionCode = /* glsl */ `
      float radius = 1.29 + aSeed.x * 1.045;
      float angle = aSeed.y * 6.2831853 + uActivityTime * .24 / pow(radius / 1.29, 1.5);
      vec3 p = vec3(cos(angle) * radius, (aSeed.z - .5) * .008, sin(angle) * radius);
      vAlpha = (.30 + uActivityEvent * .55) * (.5 + aSeed.z * .5);
      float along = dot(p,uSurfaceSun);
      float closest = sqrt(max(dot(p,p) - along * along,0.0));
      float feather = .008 + max(-along,0.0) * tan(uSunAngularRadius);
      float visibility = along < 0.0 ? smoothstep(1.0-feather,1.0+feather,closest) : 1.0;
      vAlpha *= mix(1.0,.06 + .94 * visibility,uShadowEnabled);
    `;
  } else if (kind === "solar") {
    positionCode = /* glsl */ `
      float progress = clamp(uActivityProgress, 0.0, 1.0);
      vec3 axis = vec3(${solarEruptionAxis.toArray().join(',')});
      vec3 side = normalize(cross(axis,vec3(0.0,1.0,0.0)));
      vec3 up = cross(axis,side);
      float angle = aSeed.x * 6.2831853 + progress * 1.2;
      float travel = max(progress - aSeed.z * .32, 0.0) * (1.4 + aSeed.w * 1.7);
      float spread = (.035 + travel * .19) * sqrt(aSeed.y);
      vec3 direction = normalize(axis + (side * cos(angle) + up * sin(angle)) * spread);
      vec3 p = direction * (1.006 + travel);
      vAlpha = sin(progress * 3.14159265) * .9 * step(0.0,uActivityProgress) * smoothstep(.0,.035,travel);
    `;
  } else if (kind === "ice" || kind === "volcanic") {
    // Each body's plumes rise from its own surface point: Enceladus vents along its south polar
    // fractures, Triton's nitrogen plumes sit in its south polar region. The vent spread stays a
    // rendering detail; the axis is the part that has to be the right body's.
    const plumeAxis = kind === "ice" ? (record.body.id === "triton" ? tritonPlumeAxis : icePlumeAxis) : volcanicAxis;
    record.plumeAnchorAxis = plumeAxis;
    const ventAxis = kind === "ice"
      ? `normalize(vec3(${plumeAxis.toArray().join(',')}) + vec3(vent * .012, 0., vent * .012))`
      : `vec3(${volcanicAxis.toArray().join(',')})`;
    positionCode = /* glsl */ `
      float age = fract(aSeed.x + uActivityTime * .16);
      float azimuth = aSeed.y * 6.2831853;
      float vent = floor(aSeed.z * 4.0);
      vec3 axis = ${ventAxis};
      vec3 side = normalize(cross(axis, vec3(1.0, 0.0, 0.0)));
      vec3 up = cross(axis, side);
      float height = ${kind === "ice" ? "age * (.22 + aSeed.w * .42)" : "sin(age * 3.14159265) * (.10 + aSeed.w * .13)"};
      float spread = age * (.016 + aSeed.z * .16);
      vec3 p = axis * (1.002 + height * (.65 + uActivityEvent * .7))
        + (side * cos(azimuth) + up * sin(azimuth)) * spread;
      vAlpha = sin(age * 3.14159265) * (.16 + uActivityEvent * .58);
    `;
  } else {
    positionCode = /* glsl */ `
      float angle = aSeed.x * 6.2831853 + uActivityTime * (.025 + aSeed.z * .016);
      float latitude = (aSeed.y - .5) * .85 + .04 * sin(uActivityTime * .2 + aSeed.x * 20.0);
      vec3 p = vec3(cos(angle)*cos(latitude),sin(latitude),sin(angle)*cos(latitude))
        * (1.009 + aSeed.w * .018);
      vAlpha = (.10 + uActivityEvent * .55) * aSeed.z;
    `;
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...record.uniforms,
      uParticleScale: { value: 1 },
      uParticleColor: {
        value: new THREE.Color(
          kind === "ice"
            ? "#c9eaf7"
            : kind === "volcanic"
              ? "#ead7a1"
              : kind === "solar"
                ? "#ff9b37"
                : kind === "rings"
                  ? "#e1d4ad"
                  : "#c68f59",
        ),
      },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uActivityTime;
      uniform float uActivityEvent;
      uniform float uActivityProgress;
      uniform float uParticleScale;
      uniform vec3 uSurfaceSun;
      uniform float uShadowEnabled;
      uniform float uSunAngularRadius;
      varying float vAlpha;
      void main() {
        ${positionCode}
        vec4 viewPosition = modelViewMatrix * vec4(p,1.0);
        gl_Position = projectionMatrix * viewPosition;
        float modelScale = length(modelMatrix[0].xyz);
        gl_PointSize = clamp(uParticleScale * modelScale * (${kind === "ice" ? ".005 + aSeed.w * .006" : ".0018 + aSeed.w * .0024"})
          / max(-viewPosition.z, .000000001), .6, 4.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uParticleColor;
      varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - .5) * 2.0;
        if (r > 1.0) discard;
        gl_FragColor = vec4(uParticleColor, (1.0-smoothstep(.25,1.0,r)) * vAlpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: kind === "dust" ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  record.body.mesh.add(points);
  record.extras.push(points);
  record.particles.push({ mesh: points, count, kind });
}

export function createDynamics(objects, { defer = false } = {}) {
  let enabled = true;
  let focus = null;
  let mobile = false;
  let rate = 1;
  const records = new Map();
  const surfaceRotation = new THREE.Quaternion();
  const cloudRotation = new THREE.Quaternion();
  const rotationMatrix = new THREE.Matrix4();
  // Shared optical-depth profile for the ring shadow lookups, and the solved
  // multiple-scattering table the ring surface reads.
  const ringOpticalDepth = createRingOpticalDepthTexture();
  const ringScattering = createRingScatteringTexture();
  const scatteringRows = shippedScatteringTable().systems
    ? Object.values(shippedScatteringTable().systems).reduce((total, system) => total + 2 * system.regions.length, 0)
    : 0;
  const ringCamera = new THREE.Vector3();
  const inverseRingMatrix = new THREE.Matrix4();
  for (const body of objects.values()) {
    const record = {
      body,
      time: 0,
      eventStart: -1000,
      eventCount: 0,
      nextEvent: 12,
      detailReady: false,
      extras: [],
      particles: [],
      uniforms: {
        uActivityTime: { value: 0 },
        uActivityEnabled: { value: 1 },
        uActivityDetail: { value: 0 },
        uActivityEvent: { value: 0 },
        uActivityProgress: { value: -1 },
        uFlowPhase: { value: 0 },
        uWeatherOffset: { value: new THREE.Vector3() },
        uSurfaceSun: { value: new THREE.Vector3(1, 1, 1).normalize() },
        uRingSun: { value: new THREE.Vector3(1, 1, 1).normalize() },
        uSurfaceToCloud: { value: new THREE.Matrix3() },
        uCloudTexture: { value: body.clouds?.material.alphaMap || null },
        uObservedCloudPrevious: { value: body.clouds?.material.alphaMap || null },
        uObservedCloudNext: { value: body.clouds?.material.alphaMap || null },
        uObservedClouds: { value: 0 },
        uObservedCloudAvailable: { value: 0 },
        uObservedCloudBlend: { value: 1 },
        uCloudAvailable: { value: body.clouds?.material.alphaMap ? 1 : 0 },
        uNightTexture: { value: body.nightMap || null },
        uRingOpticalDepth: { value: ringOpticalDepth },
        uRingScattering: { value: ringScattering.texture },
        uRingScatteringRow: { value: SCATTERING_ROW_BASE[body.id] ?? 0 },
        uRingScatteringRows: { value: scatteringRows },
        uRingSpan: { value: new THREE.Vector2(RING_INNER, RING_OUTER) },
        uRingCamera: { value: new THREE.Vector3(0, 0, 1) },
        // Henyey-Greenstein asymmetry of this system's ring particles, negative
        // because they backscatter. Saturn's is measured; the other systems fall back
        // to it, which BODY_MODELS.md states as an assumption.
        uRingPhaseG: { value: ringSystemFor(body.id)?.phaseG ?? 0 },
        uRingSurgeScale: { value: RING_SURGE_SCALE_RAD },
        // Viewport height in device pixels; the vertex widening turns it into a screen
        // width. Replaced every frame from the caller's pixelScale.
        uRingPixelScale: { value: 1080 },
        uCloudVisible: { value: 1 },
        uNightEnabled: { value: body.nightMap ? 1 : 0 },
        uShadowEnabled: { value: 1 },
        uBodyPolarRatio: { value: body.shape?.[1] || 1 },
        uSunAngularRadius: { value: 0.0005 },
      },
    };
    records.set(body.id, record);
    if (!defer) activate(body.id);
  }

  function activate(id) {
    const record = records.get(id);
    if (!record || record.activated) return;
    record.activated = true;
    const body = record.body;
    refreshTextures(id);
    if (body.id === "sun") attachSolarSurface(record);
    if (body.id === "earth") {
      attachEarthClouds(record);
      attachEarthSurface(record);
    }
    if (body.id === "io") {
      patchMaterial(body.mesh.material, "io", record.uniforms, {
        emissivemap_fragment: /* glsl */ `
          #include <emissivemap_fragment>
          vec3 p = normalize(vActivityDir);
          float hot = exp(-pow(length(p - normalize(vec3(.07,.19,.98))) / .038, 2.0))
            + .6 * exp(-pow(length(p - normalize(vec3(-.78,-.32,.53))) / .025, 2.0))
            + .5 * exp(-pow(length(p - normalize(vec3(.61,-.51,-.60))) / .030, 2.0));
          float pulse = .75 + .25 * sin(uActivityTime * 1.8 + weatherNoise(p * 20.0));
          totalEmissiveRadiance += vec3(1.0,.12,.006) * hot * pulse
            * (.45 + uActivityEvent * 3.0) * uActivityEnabled;
        `,
      });
    }
    if (
      ["venus", "jupiter", "saturn", "uranus", "neptune", "titan"].includes(
        body.id,
      )
    ) {
      patchMaterial(body.mesh.material, body.id, record.uniforms, {
        map_fragment: gasMap(body.id),
        ...(body.id === "saturn"
          ? { lights_fragment_begin: saturnDirectLighting(
              // Origin the shadow ray at the real surface point. Re-normalising it would
              // lift the ray off a flattened globe and slide the band in latitude.
              "ringTransmission(vActivityPosition,normalize(vActivityViewToLocal * directLight.direction))",
            ) }
          : {}),
      });
    }
    if (body.ring && ringSystems[body.id]) attachRingSurface(record);
    if (id === focus) ensureDetail(record);
  }

  function refreshTextures(id) {
    const record = records.get(id);
    if (!record) return;
    const { body, uniforms } = record;
    const clouds = body.clouds?.material.alphaMap || null;
    uniforms.uCloudTexture.value = clouds;
    uniforms.uCloudAvailable.value = clouds ? 1 : 0;
    uniforms.uNightTexture.value = body.nightMap || null;
  }

  function ensureDetail(record) {
    if (record.detailReady) return;
    record.detailReady = true;
    if (record.body.id === "sun") {
      createProminences(record);
      createParticles(record, "solar");
    }
    if (record.body.id === "mars") {
      attachDust(record);
      attachMarsFrost(record);
      attachGanymedeAurora(record);
      createParticles(record, "dust");
    }
    if (record.body.id === "saturn") createParticles(record, "rings");
    if (record.body.id === "enceladus") createParticles(record, "ice");
    if (record.body.id === "triton") createParticles(record, "ice");
    if (record.body.id === "io") createParticles(record, "volcanic");
  }

  function trigger(id = focus) {
    const record = records.get(id);
    if (!record || !enabled || id !== focus) return false;
    record.eventStart = record.time;
    record.eventCount++;
    record.nextEvent = record.time + activityProfiles[id].interval;
    return true;
  }

  function setFocus(id) {
    if (id === focus) return;
    focus = id;
    const record = records.get(id);
    if (record?.activated) {
      ensureDetail(record);
      if (record.time - record.eventStart > activityProfiles[id].duration)
        record.nextEvent = record.time + 11;
    }
  }

  // The caps move on the planet's own clock, so they are recomputed when the simulation date moves
  // by more than a fraction of a day rather than every frame.
  let marsFrostDay = null;
  function updateMarsFrost(date) {
    const mars = records.get("mars");
    if (!mars?.uniforms.uMarsFrostNorth || !date) return;
    const day = Math.floor(Date.parse(date) / 86400000);
    if (day === marsFrostDay) return;
    marsFrostDay = day;
    const edges = marsPolarFrostEdges(marsSolarLongitude(new Date(date)));
    mars.uniforms.uMarsFrostNorth.value = edges.northLatitude;
    mars.uniforms.uMarsFrostSouth.value = edges.southLatitude;
  }

  // The plasma sweep is set by Jupiter's rotation, so the aurora's phase is a function of the
  // simulation date: brightness and a small latitudinal rocking, both at System III's period.
  function updateGanymedeAurora(date) {
    const ganymede = records.get("ganymede");
    if (!ganymede?.uniforms.uGanymedeAurora || !date) return;
    const phase = (Date.parse(date) / 1000 % GANYMEDE_AURORA_PERIOD_SECONDS) / GANYMEDE_AURORA_PERIOD_SECONDS * Math.PI * 2;
    ganymede.uniforms.uGanymedeAurora.value = .35 + .65 * (.5 + .5 * Math.sin(phase));
    ganymede.uniforms.uGanymedeOvalShift.value = 4.0 * Math.sin(phase + 1.1);
  }

  function update({ dt, moving, selected, isMobile, pixelScale, date }) {
    setFocus(selected);
    mobile = isMobile;
    for (const [id, record] of records) {
      const observed = id === "earth" && record.uniforms.uObservedClouds.value > .5;
      const active = enabled && id === focus && !observed;
      const profile = activityProfiles[id];
      if (moving && enabled && (!focus || id === focus))
        record.time += dt * rate;
      if (
        moving &&
        active &&
        !profile.illumination &&
        record.time >= record.nextEvent &&
        (id !== "venus" || record.body.layerVisible)
      )
        trigger(id);
      const progress = (record.time - record.eventStart) / profile.duration;
      const inEvent = progress >= 0 && progress <= 1;
      const envelope = inEvent
        ? Math.pow(Math.sin(progress * Math.PI), 0.8)
        : 0;
      const layerAvailable = id !== "venus" || record.body.layerVisible;
      record.uniforms.uActivityTime.value = record.time;
      if (id === "mars") updateMarsFrost(date);
      if (id === "ganymede") updateGanymedeAurora(date);
      record.uniforms.uFlowPhase.value = (record.time / FLOW_PERIOD) % 1;
      record.uniforms.uWeatherOffset.value.set(
        Math.sin(record.time * 0.013) * 4,
        Math.cos(record.time * 0.017) * 3,
        Math.sin(record.time * 0.019) * 4,
      );
      record.uniforms.uActivityEnabled.value =
        enabled && layerAvailable ? 1 : 0;
      record.uniforms.uActivityDetail.value = active ? 1 : 0.12;
      record.uniforms.uActivityEvent.value = observed ? 0 : envelope;
      record.uniforms.uActivityProgress.value = inEvent ? progress : -1;
      if (id === "titan" && record.body.clouds) {
        // A second, slower haze layer gives Titan's generated atmospheric map
        // visible motion without changing the dated body rotation.
        record.body.clouds.quaternion.copy(record.body.mesh.quaternion);
        record.body.clouds.rotateY(record.time * 0.00055);
        record.body.clouds.material.opacity = 0.24 + 0.08 * (0.5 + 0.5 * Math.sin(record.time * 0.17));
      }
      for (const extra of record.extras) extra.visible = active;
      for (const particle of record.particles) {
        particle.mesh.geometry.setDrawRange(
          0,
          mobile ? Math.floor(particle.count * 0.44) : particle.count,
        );
        particle.mesh.material.uniforms.uParticleScale.value = pixelScale;
        if (particle.kind === "solar")
          particle.mesh.visible = active && inEvent;
      }
      // The ring widening needs the viewport height every frame, the same value the
      // particles are sized with.
      if (record.uniforms.uRingPixelScale) record.uniforms.uRingPixelScale.value = pixelScale;
    }
  }

  return {
    update, activate, refreshTextures,
    featureAnchor(id, kind) {
      const record = records.get(id);
      if (!enabled || focus !== id || !record?.detailReady) return null;
      const progress = record.uniforms.uActivityProgress.value;
      const strength = record.uniforms.uActivityEvent.value;
      let point;
      if (kind === 'prominence' && record.prominenceAnchor) {
        const anchor = record.prominenceAnchor;
        const life = .28 + .72 * THREE.MathUtils.smoothstep(Math.sin(record.time * .14 + anchor.phase), -.8, .85);
        point = anchor.point.clone().addScaledVector(anchor.point.clone().normalize(), (life - .5) * .045 + strength * .03);
      } else if (kind === 'solar-eruption' && progress > .03 && progress < .97) {
        point = solarEruptionAxis.clone().multiplyScalar(1.006 + Math.max(progress - .16, 0) * 2.25);
      } else if (kind === 'volcanic-plume' && strength > .06) {
        point = (record.plumeAnchorAxis || volcanicAxis).clone().multiplyScalar(1.002 + .13 * (.65 + strength * .7));
      } else if (kind === 'ice-plume') {
        point = (record.plumeAnchorAxis || icePlumeAxis).clone().multiplyScalar(1.002 + .24 * (.65 + strength * .7));
      }
      return point ? { point, viewDirection: plumeViewDirection(point) } : null;
    },
    earthCloudTexture: () => records.get("earth").uniforms.uCloudTexture.value,
    setEarthClouds({ enabled, available, previous, next, mix }) {
      const uniforms = records.get("earth").uniforms;
      uniforms.uObservedClouds.value = enabled ? 1 : 0;
      uniforms.uObservedCloudAvailable.value = available ? 1 : 0;
      uniforms.uObservedCloudPrevious.value = previous;
      uniforms.uObservedCloudNext.value = next;
      uniforms.uObservedCloudBlend.value = mix;
    },
    updateLighting({ nightLights, shadows }, cameraWorld = null) {
      for (const id of ["earth", "saturn"]) {
        const record = records.get(id);
        const body = record.body;
        body.root.updateWorldMatrix(true, true);
        const sun = body.sunDirection;
        record.uniforms.uSunAngularRadius.value = body.sunAngularRadius;
        body.mesh.getWorldQuaternion(surfaceRotation);
        record.uniforms.uSurfaceSun.value
          .copy(sun)
          .applyQuaternion(surfaceRotation.clone().invert());
        record.uniforms.uNightEnabled.value =
          nightLights && body.nightMap ? 1 : 0;
        record.uniforms.uShadowEnabled.value = shadows ? 1 : 0;
        if (body.clouds) {
          body.clouds
            .getWorldQuaternion(cloudRotation)
            .invert()
            .multiply(surfaceRotation);
          rotationMatrix.makeRotationFromQuaternion(cloudRotation);
          record.uniforms.uSurfaceToCloud.value.setFromMatrix4(rotationMatrix);
          record.uniforms.uCloudVisible.value = body.clouds.visible ? 1 : 0;
        }
        if (body.ring) {
          body.ring.getWorldQuaternion(cloudRotation).invert();
          record.uniforms.uRingSun.value
            .copy(sun)
            .applyQuaternion(cloudRotation);
          if (cameraWorld) {
            // Camera in the ring's own frame, for the view angle through the slab.
            body.ring.updateWorldMatrix(true, false);
            ringCamera
              .copy(cameraWorld)
              .applyMatrix4(inverseRingMatrix.copy(body.ring.matrixWorld).invert());
            record.uniforms.uRingCamera.value.copy(ringCamera);
          }
        }
      }
    },
    trigger,
    setFocus,
    eventViewDirection(id) {
      if (activityProfiles[id].illumination) {
        const body = records.get(id).body;
        const sunlight = body.sunDirection;
        const north = new THREE.Vector3(0, 1, 0);
        // Observe the terminator by moving the camera, never by moving the light.
        return new THREE.Vector3().crossVectors(sunlight, north).normalize()
          .addScaledVector(sunlight, .2).addScaledVector(north, .12).normalize();
      }
      if (id === "enceladus" || id === "io") {
        const mesh = records.get(id).body.mesh;
        mesh.updateWorldMatrix(true, false);
        return new THREE.Vector3(
          ...(id === "enceladus" ? [0.2, -0.24, 1] : [0.8, 0.15, 0.6]),
        ).transformDirection(mesh.matrixWorld);
      }
      const uv = {
        venus: [0.22, 0.55],
        earth: [0.773, 0.45],
        mars: [0.225, 0.46],
        jupiter: [0.365, 0.39],
        uranus: [0.24, 0.54],
        neptune: [0.23, 0.42],
      }[id];
      if (!uv) return null;
      const record = records.get(id);
      const mesh = record.body.clouds || record.body.mesh;
      mesh.updateWorldMatrix(true, false);
      const phi = uv[0] * TAU;
      const theta = (1 - uv[1]) * Math.PI;
      return new THREE.Vector3(
        -Math.cos(phi) * Math.sin(theta),
        Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
      ).transformDirection(mesh.matrixWorld);
    },
    setEnabled(value) {
      enabled = value;
    },
    setRate(value) {
      rate = THREE.MathUtils.clamp(value, 0.5, 4);
    },
    status() {
      const record = records.get(focus);
      if (!record) return null;
      const event = record.uniforms.uActivityProgress.value >= 0;
      return {
        enabled,
        rate,
        event,
        label: !enabled
          ? "活动已关闭"
          : focus === "venus" && !record.body.layerVisible
            ? "雷达地表"
            : event
              ? activityProfiles[focus].active
              : activityProfiles[focus].idle,
      };
    },
    snapshot() {
      return {
        enabled,
        rate,
        focus,
        mobile,
        bodies: [...records].map(([id, r]) => ({
          id,
          time: r.time,
          detail: r.uniforms.uActivityDetail.value,
          event: r.uniforms.uActivityEvent.value,
          eventProgress: r.uniforms.uActivityProgress.value,
          eventCount: r.eventCount,
          sunDirection: r.uniforms.uSurfaceSun.value.toArray(),
          cloudTransform: r.uniforms.uSurfaceToCloud.value.toArray(),
          observedClouds: r.uniforms.uObservedClouds.value,
          observedCloudBlend: r.uniforms.uObservedCloudBlend.value,
          nightEnabled: r.uniforms.uNightEnabled.value,
          shadowsEnabled: r.uniforms.uShadowEnabled.value,
          detailReady: r.detailReady,
          extraCount: r.extras.length,
          visibleExtras: r.extras.filter((extra) => extra.visible).length,
          particleCount: r.particles.reduce(
            (count, p) =>
              count + (p.mesh.visible ? p.mesh.geometry.drawRange.count : 0),
            0,
          ),
        })),
      };
    },
    dispose() {
      for (const record of records.values())
        for (const extra of record.extras) {
          extra.traverse((child) => {
            child.geometry?.dispose();
            child.material?.dispose();
          });
          extra.removeFromParent();
        }
    },
  };
}
