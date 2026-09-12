# 贴图导入记录

后续生成、重绘、修缝及接入验收遵循本项目的 [贴图工作流程](TEXTURE_WORKFLOW.md)。通用生图 skill 只维护接口使用，不存储项目贴图规范。

本次从 `C:\Users\买辣条送的电脑\.zcode\workspace\default\iapetus-miranda-preview\assets` 导入并处理了以下公开探测贴图：

- 土卫一 Mimas、土卫三 Tethys、土卫四 Dione、土卫五 Rhea、土卫八 Iapetus：保留 4K 版本，运行默认加载 2K JPEG。
- 土卫九 Phoebe：使用提供的 2048 × 1024 全球图。
- 天卫五 Miranda：使用提供的 1440 × 720 全球图，未进行无依据的放大。

最初没有可靠全球图的木卫五、木卫十四、木卫十五、木卫十六、木卫六，以及环卫星和三个矮行星使用低对比度程序化表面。2026-09-12 将 26 张此类纹理，以及有大片缺测的天卫五、土卫九地图，替换为完整 AI 艺术地表。全景使用 1920 × 960，近看按需加载原生 3840 × 1920 无损版本；原素材仍保留。图鉴卡片标注“AI 艺术重绘 / 完整地表”，详细处理范围见 [艺术地表记录](../public/solar-system/textures/artistic/README.md)。

卫星事实和轨道周期按 JPL Satellite Physical Parameters / Satellite Mean Elements 的平均值录入，轨道仍是展示用平均圆轨道。
