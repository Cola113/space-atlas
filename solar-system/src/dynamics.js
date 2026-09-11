import * as THREE from "three";
import simplexSource from "glsl-noise/simplex/3d.glsl?raw";
import { additionalBodies } from "./additional-bodies.js";

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
  uniform float uActivityTime;
  uniform float uActivityEnabled;
  uniform float uActivityDetail;
  uniform float uActivityEvent;
  uniform float uActivityProgress;
  uniform float uFlowPhase;
  uniform vec3 uWeatherOffset;
  uniform vec3 uSurfaceSun;
  uniform vec3 uRingSun;
  uniform mat3 uSurfaceToCloud;
  uniform sampler2D uCloudTexture;
  uniform sampler2D uObservedCloudPrevious;
  uniform sampler2D uObservedCloudNext;
  uniform float uObservedClouds;
  uniform float uObservedCloudAvailable;
  uniform float uObservedCloudBlend;
  uniform sampler2D uNightTexture;
  uniform sampler2D uRingTexture;
  uniform float uCloudAvailable;
  uniform float uCloudVisible;
  uniform float uNightEnabled;
  uniform float uShadowEnabled;
  uniform float uBodyRadius;
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
    const saturnShadow = key === "saturn" || key === "saturn-rings";
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vActivityDir; varying vec2 vActivityUv; varying vec3 vActivityPosition;" +
          (saturnShadow ? "\nvarying mat3 vActivityViewToLocal;" : ""),
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvActivityDir = normalize(position); vActivityUv = uv; vActivityPosition = position;" +
          (saturnShadow ? "\nvActivityViewToLocal = transpose(mat3(modelViewMatrix));" : ""),
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\n${common}${saturnShadow ? saturnShadowFunctions : ""}`,
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
      float night = 1.0 - smoothstep(-.14,.10,dot(normalize(vActivityDir),uSurfaceSun));
      vec3 nightColor = texture2D(uNightTexture,vActivityUv).rgb;
      float cityMask = smoothstep(.012,.12,max(nightColor.r,nightColor.g));
      totalEmissiveRadiance += nightColor * cityMask * night * uNightEnabled * 1.6;
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
  float ringOpacity(float radiusUv, float footprint) {
    float edge = max(footprint, .001);
    float mask = smoothstep(-edge, edge, radiusUv)
      * (1.0 - smoothstep(1.0-edge, 1.0+edge, radiusUv));
    return textureGrad(uRingTexture, vec2(clamp(radiusUv,0.0,1.0),.5),
      vec2(footprint,0.0), vec2(0.0)).a * mask;
  }
  float ringRayOpacity(vec3 p, vec3 lightDirection, float angularWidth) {
    float safeY = (lightDirection.y < 0.0 ? -1.0 : 1.0) * max(abs(lightDirection.y),.0001);
    float travel = -p.y / safeY;
    vec2 intersection = (p + lightDirection * travel).xz;
    float ringRadius = length(intersection);
    float ringUv = (ringRadius - 1.28) / 1.07;
    float radialDerivative = abs(dot(intersection, lightDirection.xz))
      / max(ringRadius * length(lightDirection.xz), .0001);
    float sourceFootprint = abs(p.y) * radialDerivative * angularWidth / (safeY * safeY * 1.07);
    float footprint = clamp(max(fwidth(ringUv), sourceFootprint), .001, .5);
    float opacity = ringOpacity(ringUv, footprint);
    return travel > .0001 ? opacity : 0.0;
  }
  float ringTransmission(vec3 p, vec3 lightDirection) {
    if (uShadowEnabled < .5) return 1.0;
    // Integrate strips of the solar disk, including rays crossing either side of the ring plane.
    vec3 horizontal = normalize(vec3(lightDirection.x, 0.0, lightDirection.z) + vec3(.000001,0.0,0.0));
    float elevation = asin(clamp(lightDirection.y, -1.0, 1.0));
    float opacity = 0.0, totalWeight = 0.0;
    for (int i = 0; i < 9; i++) {
      float offset = (float(i) - 4.0) / 4.5;
      float weight = sqrt(1.0 - offset * offset);
      float angle = elevation + offset * uSunAngularRadius;
      vec3 direction = horizontal * cos(angle) + vec3(0.0, sin(angle), 0.0);
      opacity += ringRayOpacity(p, direction, uSunAngularRadius / 4.5) * weight;
      totalWeight += weight;
    }
    return 1.0 - opacity / totalWeight * .92 * uShadowEnabled;
  }
  float planetTransmission(vec3 p, vec3 lightDirection) {
    float along = dot(p,lightDirection);
    float closest = length(cross(p,lightDirection));
    float feather = max(fwidth(closest) * 1.5,
      .001 + max(-along,0.0) * tan(uSunAngularRadius));
    float visibility = along < 0.0 ? smoothstep(1.0-feather,1.0+feather,closest) : 1.0;
    return mix(1.0,visibility,uShadowEnabled);
  }
`;

function saturnDirectLighting(transmission, scatter = false) {
  // Apply occlusion to incident light before accumulating direct illumination.
  // Ring particles also scatter across the plane, unlike an opaque Lambert surface.
  return THREE.ShaderChunk.lights_fragment_begin.replaceAll(
    "RE_Direct( directLight,",
    `directLight.color *= ${transmission};\n${scatter ? "reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * .05;\n" : ""}RE_Direct( directLight,`,
  );
}

function attachRingSurface(record) {
  patchMaterial(record.body.ring.material, "saturn-rings", record.uniforms, {
    lights_fragment_begin: saturnDirectLighting(
      "planetTransmission(vActivityPosition / uBodyRadius,normalize(vActivityViewToLocal * directLight.direction))",
      true,
    ),
    lights_fragment_end: /* glsl */ `
      #include <lights_fragment_end>
      // Ring particles scatter sunlight above; broad fill remains outside the solar shadow.
      reflectedLight.indirectDiffuse += diffuseColor.rgb * .025;
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
      vec3 axis = normalize(vec3(.88,.32,.26));
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
    positionCode = /* glsl */ `
      float age = fract(aSeed.x + uActivityTime * .16);
      float azimuth = aSeed.y * 6.2831853;
      float vent = floor(aSeed.z * 4.0);
      vec3 axis = ${kind === "ice" ? "normalize(vec3(.10 + vent * .025, -1.0, .06 * sin(vent * 2.0)))" : "normalize(vec3(.07, .19, .98))"};
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

export function createDynamics(objects) {
  let enabled = true;
  let focus = null;
  let mobile = false;
  let rate = 1;
  const records = new Map();
  const surfaceRotation = new THREE.Quaternion();
  const cloudRotation = new THREE.Quaternion();
  const rotationMatrix = new THREE.Matrix4();
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
        uRingTexture: { value: body.ring?.material.map || null },
        uCloudVisible: { value: 1 },
        uNightEnabled: { value: body.nightMap ? 1 : 0 },
        uShadowEnabled: { value: 1 },
        uBodyRadius: { value: body.radius },
        uSunAngularRadius: { value: 0.0005 },
      },
    };
    records.set(body.id, record);
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
              "ringTransmission(normalize(vActivityDir),normalize(vActivityViewToLocal * directLight.direction))",
            ) }
          : {}),
      });
    }
    if (body.id === "saturn") attachRingSurface(record);
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
      createParticles(record, "dust");
    }
    if (record.body.id === "saturn") createParticles(record, "rings");
    if (record.body.id === "enceladus") createParticles(record, "ice");
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
    if (record) {
      ensureDetail(record);
      if (record.time - record.eventStart > activityProfiles[id].duration)
        record.nextEvent = record.time + 11;
    }
  }

  function update({ dt, moving, selected, isMobile, pixelScale }) {
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
        record.body.clouds.rotation.y = record.time * 0.00055;
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
    }
  }

  return {
    update,
    earthCloudTexture: () => records.get("earth").uniforms.uCloudTexture.value,
    setEarthClouds({ enabled, available, previous, next, mix }) {
      const uniforms = records.get("earth").uniforms;
      uniforms.uObservedClouds.value = enabled ? 1 : 0;
      uniforms.uObservedCloudAvailable.value = available ? 1 : 0;
      uniforms.uObservedCloudPrevious.value = previous;
      uniforms.uObservedCloudNext.value = next;
      uniforms.uObservedCloudBlend.value = mix;
    },
    updateLighting({ nightLights, shadows }) {
      for (const id of ["earth", "saturn"]) {
        const record = records.get(id);
        const body = record.body;
        body.root.updateWorldMatrix(true, true);
        const solarBody = objects.get("sun");
        const sun = solarBody.root.position.clone().sub(body.root.position).normalize();
        record.uniforms.uSunAngularRadius.value = Math.asin(
          Math.min(0.95, solarBody.radius / body.root.position.distanceTo(solarBody.root.position)),
        );
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
        }
      }
    },
    trigger,
    setFocus,
    eventViewDirection(id) {
      if (activityProfiles[id].illumination) {
        const body = records.get(id).body;
        const sunlight = objects.get("sun").root.position.clone().sub(body.root.position).normalize();
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
