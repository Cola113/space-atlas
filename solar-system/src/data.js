import { resolvePhysicalFacts } from './catalog-facts.js';
import { additionalBodies } from "./additional-bodies.js";
import { bodyModels } from './body-models.js';
import { ringSystemFor, ringSpan } from './ring-systems.js';

export const ORBIT_SPACING = 2;

export const bodies = [
  {
    id: "sun",
    body: "Sun",
    name: "太阳",
    english: "SUN",
    category: "G2V 型恒星",
    color: "#f4bc64",
    texture: "sun",
    high: "8k_sun.jpg",
    radius: 4.5,
    orbit: 0,
    description:
      "太阳系的中心恒星。持续的核聚变释放光和热，为遥远的行星带来能量。",
    facts: [
      ["physical:radius"],
      ["光球温度", "5,500", "°C"],
      ["年龄 · 约", "46", "亿年"],
      ["类型", "黄矮星", ""],
    ],
    feature: "光球与太阳活动",
    featureText: "颗粒状的光球覆盖着恒星表面，太阳黑子来自局部较低温的区域。",
    caption: "太阳光球",
    detail: "可见光纹理 · 非实时影像",
    closeName: "观测光球",
    source: "sun",
  },
  {
    id: "mercury",
    body: "Mercury",
    name: "水星",
    english: "MERCURY",
    category: "01 / 类地行星",
    color: "#a49e91",
    texture: "mercury",
    high: "8k_mercury.jpg",
    radius: 0.62,
    orbit: 9,
    description:
      "距离太阳最近，也是八大行星中最小的一颗。稀薄的外逸层下，古老撞击坑遍布地表。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "天"],
      ["日照面温度 · 约", "430", "°C"],
      ["physical:distance"],
    ],
    feature: "撞击坑与古老平原",
    featureText: "明亮的撞击射纹与暗色平原，记录了这颗岩石世界漫长的演化。",
    caption: "水星地表",
    detail: "撞击盆地 / 明亮射纹",
    closeName: "观测地表",
    source: "mercury",
  },
  {
    id: "venus",
    body: "Venus",
    name: "金星",
    english: "VENUS",
    category: "02 / 类地行星",
    color: "#d7b778",
    texture: "venus_atmosphere",
    high: "8k_venus_surface.jpg",
    radius: 1.02,
    orbit: 13,
    description:
      "浓密的二氧化碳大气包裹着金星。强烈的温室效应，让它成为太阳系最炽热的行星。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "天"],
      ["平均地表温度", "464", "°C"],
      ["physical:distance"],
    ],
    feature: "云海之下的火山世界",
    featureText: "硫酸云遮住了地表。雷达地图揭示出大片火山平原和起伏的高地。",
    caption: "金星云层",
    detail: "硫酸云 / 浓密大气",
    closeName: "观测地表",
    layer: "显示云层",
    source: "venus",
  },
  {
    id: "earth",
    body: "Earth",
    name: "地球",
    english: "EARTH",
    category: "03 / 类地行星",
    color: "#7bc3d9",
    texture: "earth_daymap",
    high: "8k_earth_daymap.jpg",
    radius: 1.08,
    orbit: 17,
    description:
      "我们的蓝色家园。海洋、陆地与流动的云层共同构成了目前唯一已知孕育生命的世界。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "天"],
      ["海洋覆盖率 · 约", "71", "%"],
      ["physical:distance"],
    ],
    feature: "海洋、大陆与云层",
    featureText: "从海岸线到广阔山脉，蓝白相间的地球不断变换着自己的面貌。",
    caption: "我们的蓝色家园",
    detail: "海洋 / 大陆 / 大气层",
    closeName: "观测地表",
    layer: "显示云层",
    source: "earth/facts",
  },
  {
    id: "mars",
    body: "Mars",
    name: "火星",
    english: "MARS",
    category: "04 / 类地行星",
    color: "#d68a65",
    texture: "mars",
    high: "8k_mars.jpg",
    radius: 0.82,
    orbit: 22,
    description:
      "一颗寒冷、干燥的红色星球。富含氧化铁的尘土之下，仍留着远古河流与湖泊的痕迹。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "天"],
      ["平均地表温度 · 约", "−65", "°C"],
      ["physical:distance"],
    ],
    feature: "峡谷、火山与极冠",
    featureText: "水手号峡谷横跨地表，奥林帕斯山则是一座巨大的盾状火山。",
    caption: "红色星球的地貌",
    detail: "火山平原 / 峡谷 / 极冠",
    closeName: "观测地表",
    source: "mars",
  },
  {
    id: "jupiter",
    body: "Jupiter",
    name: "木星",
    english: "JUPITER",
    category: "05 / 气态巨行星",
    color: "#d4bc94",
    texture: "jupiter",
    high: "8k_jupiter.jpg",
    radius: 2.65,
    orbit: 31,
    description:
      "太阳系最大的行星。快速自转将高层大气织成明暗相间的云带，巨大的风暴在其中翻涌。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "年"],
      ["physical:spin"],
      ["physical:distance"],
    ],
    feature: "云带与大红斑",
    featureText:
      "大红斑是一场长期存在的巨大风暴。近景展示云顶纹理，木星没有固体表面。",
    caption: "木星大气",
    detail: "明暗云带 / 大红斑",
    closeName: "观测大气",
    source: "jupiter",
  },
  {
    id: "saturn",
    body: "Saturn",
    name: "土星",
    english: "SATURN",
    category: "06 / 气态巨行星",
    color: "#e2cb98",
    texture: "saturn",
    high: "8k_saturn.jpg",
    radius: 2.18,
    orbit: 41,
    description:
      "被明亮冰环环绕的气态巨行星。轻盈的淡金色云层之下，是以氢和氦为主的大气。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "年"],
      ["physical:spin"],
      ["physical:distance"],
    ],
    feature: "冰粒组成的光环",
    featureText:
      "无数冰粒与岩石碎块沿轨道运行，组成宽阔而纤薄的环系。土星没有固体表面。",
    caption: "土星与光环",
    detail: "冰粒环系 / 云顶纹理",
    closeName: "观测大气",
    source: "saturn",
  },
  {
    id: "uranus",
    body: "Uranus",
    name: "天王星",
    english: "URANUS",
    category: "07 / 冰巨行星",
    color: "#a9d7d7",
    texture: "uranus",
    high: null,
    radius: 1.58,
    orbit: 51,
    description:
      "几乎侧躺着绕太阳运行的冰巨行星。大气中的甲烷吸收红光，让它呈现淡淡的蓝绿色。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "年"],
      ["physical:spin"],
      ["physical:distance"],
    ],
    feature: "平静外观下的大气",
    featureText:
      "可见光下的云层对比较低。淡青色的外观来自高层大气，并非冰冻的固体表面。",
    caption: "天王星大气",
    detail: "甲烷大气 / 低对比云层",
    closeName: "观测大气",
    source: "uranus",
  },
  {
    id: "neptune",
    body: "Neptune",
    name: "海王星",
    english: "NEPTUNE",
    category: "08 / 冰巨行星",
    color: "#7f9de8",
    texture: "neptune",
    high: null,
    radius: 1.52,
    orbit: 61,
    description:
      "八大行星中距离太阳最远的一颗。寒冷的大气中，强烈的风推动着云层与不断变化的风暴。",
    facts: [
      ["physical:radius"],
      ["physical:orbit", "年"],
      ["physical:spin"],
      ["physical:distance"],
    ],
    feature: "遥远世界的风暴",
    featureText:
      "高空云系在快速流动的大气中变化。蓝色贴图经过增强，风暴并非实时观测。",
    caption: "海王星大气",
    detail: "高空云系 / 风暴示意",
    closeName: "观测大气",
    source: "neptune",
  },
  ...additionalBodies,
].map((body) => {
  const system = ringSystemFor(body.id);
  return { ...body, ...bodyModels[body.id],
    // Ring radii for camera framing and system extent come from the declared region
    // list, so a new ring system cannot disagree with the mesh that is drawn.
    ...(system ? { rings: ringSpan(system) } : {}),
    facts: resolvePhysicalFacts(body), orbit: body.orbit * ORBIT_SPACING };
});

// Reserve the full moon system, so neighbouring systems cannot intersect at conjunction.
let outerEdge = 0;
for (const body of bodies.filter((body) => !body.parent).sort((a, b) => a.orbit - b.orbit)) {
  const extent = Math.max(
    body.radius * (body.id === "saturn" ? 2.35 : body.rings?.outer || 1),
    ...bodies.filter((moon) => moon.parent === body.id).map((moon) => moon.orbit + moon.radius),
  );
  if (body.orbit) body.orbit = Math.max(body.orbit, outerEdge + extent + 1);
  outerEdge = body.orbit + extent;
}
export const SYSTEM_RADIUS = outerEdge;
