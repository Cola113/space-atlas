import { physicalDefinitions } from './physics/definitions.js';

// Display shapes and prose only. Motion definitions live in physics/body-definitions.json
// and the astronomical providers; shape ratios never change physical radii.
function measuredAxes(id) {
  const [a,b,c] = physicalDefinitions.bodies[id].radius.semiAxesKm;
  return [1,c/a,b/a]; // Three's +Y axis is the spin axis.
}

// Every body whose radius record carries semi-axes takes its silhouette from those
// numbers, so the globe mesh, the landmark anchors, the landing pins and the ring
// shadow all share one sourced shape. A body with three equal semi-axes is rendered
// as a sphere because its source adopted a sphere, not because we assumed one.
// Sources, retrieval dates and the residual approximations are in BODY_MODELS.md.
const measuredShapes = Object.fromEntries(
  Object.entries(physicalDefinitions.bodies)
    .filter(([, body]) => body.radius.semiAxesKm)
    .map(([id]) => [id, { shape: measuredAxes(id) }]),
);

// Bodies with no published triaxial shape. Their outline is still an assumption and
// is labelled as one in BODY_MODELS.md; nothing here may be read as a measurement.
const estimatedShapes = {
  namaka: { shape: [1, .82, .9], shapeEstimated: true },
};

export const bodyModels = {
  ...measuredShapes,
  ...estimatedShapes,
  makemake: { spinNote: '自转约 22.8 小时（采用双峰解）' },
  haumea: { ...measuredShapes.haumea, rings: {inner: 1.94, outer: 2.08}, spinNote: '自转约 3.92 小时；极轴采用掩星环平面的优选解，经线零点未校准' },
  eris: { spinNote: '自转约 15.8 天，与阋卫一同步' },
  phoebe: { ...measuredShapes.phoebe, spinNote: '独立自转约 9.3 小时' },
  himalia: { ...measuredShapes.himalia, spinNote: '独立自转约 7.78 小时' },
  nereid: { ...measuredShapes.nereid, spinNote: '独立自转约 11.6 小时' },
  hyperion: { ...measuredShapes.hyperion, spinNote: '非规则翻滚示意，不能预测实际朝向' },
  ariel: { ...measuredShapes.ariel, description: '天王星的主要冰质卫星之一，近球形的表面交织着峡谷、断裂和撞击坑。' },
  umbriel: { ...measuredShapes.umbriel, description: '天王星的主要冰质卫星之一，近球形的深暗表面保存了密集的古老撞击坑。' },
  titania: { ...measuredShapes.titania, description: '天王星最大的卫星，近球形的冰岩世界，表面留有巨大断裂和撞击痕迹。' },
  oberon: { ...measuredShapes.oberon, description: '天王星外侧的主要卫星，近球形的古老地表布满撞击坑和明亮喷出物。' },
  atlas: { ...measuredShapes.atlas, ridge: {height: .30, width: .11} },
  pan: { ...measuredShapes.pan, ridge: {height: .32, width: .12} },
  janus: { ...measuredShapes.janus, orbit: 3.15, spinNote: '当前为平均椭圆，未模拟真实的约四年共轨道交换；放大的模型可能在示意图中重叠' },
  epimetheus: { ...measuredShapes.epimetheus, orbit: 3.15, spinNote: '当前为平均椭圆，未模拟真实的约四年共轨道交换；放大的模型可能在示意图中重叠' },
  hiiaka: { ...measuredShapes.hiiaka, spinNote: '独立自转约 9.68 小时；尺寸与轮廓采用 2025 年发表的掩星模型，地貌仍为艺术示意' },
  dysnomia: { spinNote: '采用与公转同步的自转示意' },
};
