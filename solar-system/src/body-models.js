import { physicalDefinitions } from './physics/definitions.js';

// Display shapes and prose only. Motion definitions live in physics/body-definitions.json
// and the astronomical providers; shape ratios never change physical radii.
function measuredAxes(id) {
  const [a,b,c] = physicalDefinitions.bodies[id].radius.semiAxesKm;
  return [1,c/a,b/a]; // Three's +Y axis is the spin axis.
}
export const bodyModels = {
  // Saturn carries the largest oblateness of the planets; flattening it is what
  // gives the globe its familiar squashed silhouette rather than a generic ball.
  saturn: { shape: measuredAxes('saturn') },
  makemake: { spinNote: '自转约 22.8 小时（采用双峰解）' },
  haumea: { shape: measuredAxes('haumea'), rings: {inner: 1.94, outer: 2.08}, spinNote: '自转约 3.92 小时；极轴采用掩星环平面的优选解，经线零点未校准' },
  vesta: { shape: measuredAxes('vesta') },
  eris: { spinNote: '自转约 15.8 天，与阋卫一同步' },
  phoebe: { spinNote: '独立自转约 9.3 小时' },
  himalia: { spinNote: '独立自转约 7.78 小时' },
  nereid: { shape: [1, .9, .94], spinNote: '独立自转约 11.6 小时' },
  hyperion: { shape: [1, .57, .76], spinNote: '非规则翻滚示意，不能预测实际朝向' },
  ariel: { shape: [1, 1, 1], description: '天王星的主要冰质卫星之一，近球形的表面交织着峡谷、断裂和撞击坑。' },
  umbriel: { shape: [1, 1, 1], description: '天王星的主要冰质卫星之一，近球形的深暗表面保存了密集的古老撞击坑。' },
  titania: { shape: [1, 1, 1], description: '天王星最大的卫星，近球形的冰岩世界，表面留有巨大断裂和撞击痕迹。' },
  oberon: { shape: [1, 1, 1], description: '天王星外侧的主要卫星，近球形的古老地表布满撞击坑和明亮喷出物。' },
  proteus: { shape: [1, .91, .96] },
  atlas: { shape: [1, .65, .92], ridge: {height: .30, width: .11} },
  pan: { shape: [1, .72, .93], ridge: {height: .32, width: .12} },
  janus: { orbit: 3.15, shape: [1, .765, .98], spinNote: '当前为平均椭圆，未模拟真实的约四年共轨道交换；放大的模型可能在示意图中重叠' },
  epimetheus: { orbit: 3.15, shape: [1, .69, .84], spinNote: '当前为平均椭圆，未模拟真实的约四年共轨道交换；放大的模型可能在示意图中重叠' },
  styx: { shape: [1, .5, .56] },
  nix: { shape: [1, .65, .70] },
  kerberos: { shape: [1, .47, .53] },
  hydra: { shape: [1, .47, .59] },
  hiiaka: { shape: measuredAxes('hiiaka'), spinNote: '独立自转约 9.68 小时；尺寸与轮廓采用 2025 年发表的掩星模型，地貌仍为艺术示意' },
  namaka: { shape: [1, .82, .9], spinNote: '自转周期未测定，采用同步自转示意' },
  dysnomia: { spinNote: '采用与公转同步的自转示意' },
};
