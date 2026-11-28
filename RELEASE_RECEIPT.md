# 发布记录

分支维护说明：用户于 2026-09-14 安排将已完成的工作合入 `main` 并清理其余远端分支，后续维护及文档链接使用 `main`。以下记录保留各次发布当时的提交与分支，不能据此判断当前分支状态。

## 2026-11-28：视觉门槛修复、海卫一/土卫八落点与文档同步

2026-11-28 推进 `main` 基线，完成四项主线任务（CI 视觉门槛修复、全仓库文档与发布状态同步、海卫一南极落点与喷泉近景确认、土卫八 `SAT441` 真实星历与赤道山脊落点），应用实现提交 `dd9bb8772e9e3db04d1cf5f54ea3cf58d70efae6`（`main`）：

- **单测与构建**：`npm test` **186/186 通过**；`npm run build`（`tsc --noEmit && vite build`）通过（保留既有 Three.js 分包体积提示）。
- **土卫八 `SAT441`（NAIF 608）真实星历与边界锚点**：`saturn` 201 个年份包纳入 `602/606/608/699`（`27.96 MiB`，最大编码上界 `0.085810 km`），`gm_de440.tpc`（`BODY608_GM = 120.5151060137642`）写入边界开普勒锚点；全部 1,206 个星历包、10,255 个参考检查最大差 `0.066720 km`；土卫八 16 个 Horizons TDB 历元最大位置差 `0.000129 km`、最大速度差 `0.0000039 km/s`。实测次土星经度接近 `354°E`（更正早年平均椭圆估算的 `210°E`）。
- **二十三处科学落点与 905 样本独立核验**：`ground-audit.test.js` 全覆盖 23 处科学落点 / 905 样本（`triton`：太阳方向 `0.2557'` / 海王星 `0.000115'` / 相位 `0.000034`；`iapetus`：太阳 `0.3016'` / 土星 `0.000051'` / 相位 `0.000015`）；`verify-ground-rendering.mjs` 11 处主星落点 × 3 相位 + 深度遮挡全通过。
- **全景素材与渲染专项**：`triton.webp` 与 `iapetus.webp` 均由 `gemini-nano-banana-2.1`（GCP Vertex AI，请求 `4K 16:9`，原始返回 `5504×3072`）经 `panorama_with_vacuum_dp_wrap` 降采样交付 `4096×2048` RGBA WebP（诚实记为 `sourceNative2to1: false`、`aiUpscaled: false`；土卫八将天际线以下地形垂直重排至 `+11.87°` 峰值、中位 `+8.53°` 而不上采样，避免山脊遮挡土星）；`verify-surface-panorama.mjs`（23 资产 2:1 / 天顶 `0` / 脚下 `255` + `triton`/`iapetus` 四屏低头与接缝）及 `verify-surface-render.mjs`（`triton` 时钟差 `0.000°` / 地平中位差 `0.01°`、`iapetus` `0.000°` / `0.54°`，0 列离群）全通过。
- **视觉门槛修复、光环像素与推荐时刻**：修正 `surface.css`（`max-height: 500px` 下 `row-gap: 6px → 8px`）、`main.js`（相机飞行步进上限放宽至 `250ms`）及 `.github/workflows/checks.yml`（`checkout@v6`、`setup-node@v6`、`upload-artifact@v7` 全转 Node 24）。`verify-sky-bodies.mjs` 实测土卫八推荐时刻 `2031-05-01T12:00:00Z` 上方天空清黑（`skyP95 = 3`），1×（`centerPeak = 199, litPixels = 338`）与 8×（`litPixels8x = 19288`）清楚亮出大张角受光土星环；`verify-moments-sunspots.mjs` 四屏通过并包含海卫一 `2026-09-26T22:00:00Z` 推荐时刻及南极氮气喷泉近景开关像素差分确认；`integration` / `saturn-shadows` / `controls` 与 `landings`（四屏验证覆盖桌面/手机/平板/短横屏及 `iapetus`/`triton` 人工看图）通过。
- **保留限制**：全站两处新全景与早先各 AI 地表同属依据探测器资料的艺术重建（非实测地形高程），星历近似、极轴外推、简化大气与非精密食相边界继续按 [REALISM_STANDARD.md](REALISM_STANDARD.md)、[GROUND_AUDIT.md](solar-system/GROUND_AUDIT.md) 与 [surface/README.md](public/surface/README.md) 公开保留。

---

## 最新追加：土星环影标注

2026-09-14 按用户要求加深土星云层上的环影，并增加“土星环投影（阴影）”常驻图例；关闭投影、返回总览或切换其它天体时隐藏图例。观测设置同步显示“土星环投影”。亮度属于展示增强，限制记录在[天体模型](solar-system/BODY_MODELS.md)。

- 正式站与备用域名均已切换至 `dpl_AjzUA2T4XBLhzCaqkeMY3cijnpgR`，部署来源 `67aca0b820b6c1d532f32696be9db0b8dd2a0d3a`，应用实现 `bc8c4077ebca5d4253000ff00611bb3c8f519f9d`。
- TypeScript/Vite 构建通过。`scripts/verify-saturn-shadows.mjs` 在本地、候选部署及未登录正式站均通过：南北极两个视角，以及桌面、手机、800×450、640×360 四屏的图例、开关、近观与天体切换，无页面或着色器错误。
- 固定北极视角的 36757 个环影像素，平均显示亮度由 50.14 降至 35.97，降低约 28.3%；关闭环影后的同视角截图与修改前逐像素一致。这是该截图的显示亮度比较，不是通用测光结论。证据 `test-results/saturn-shadows/contrast.json`。
- 候选部署 655 个文件与本地构建哈希一致，18 条资料链接、4 条入口通过；正式站和备用域名的版本标记、三个场景入口及所引用 JS/CSS 均匹配。报告在 `test-results/release/saturn-candidate-http/`、`saturn-candidate-saturn/`、`saturn-production/` 与 `saturn-production-http.json`。
- 候选访问凭据的边缘生效有延迟；等待生效后完整重跑通过，临时凭据已撤销。未更改部署保护配置。
- 工作仍在 `codex/main-realism-performance-20260914`；`main` 仍为 `8446be90000e776779317c99c2de4eb0c0f3e946`，未读取废弃分支。上一生产部署 `dpl_4PuFneawMUpLNJwNGCqecDoi49Hq` 已确认 READY 并保留，需要撤销本次环影调整时可回退至该部署。

以下为本次环影调整前的基础发布记录，保留原始验收证据与更早回退点。

2026-09-14 发布完成。共享物理与九落点天空、跟随自转、太阳系分批加载、星云四档与自动挡、全站按钮布局均已实施，并完成数值、构建、浏览器及线上验收。逐项范围与精度边界见 [验收矩阵](RELEASE_ACCEPTANCE.md)。

## 基础版本

- 正式站：[space.colafun.xyz](https://space.colafun.xyz/)。备用：[space-atlas-pi.vercel.app](https://space-atlas-pi.vercel.app/)。
- 生产部署：`dpl_4PuFneawMUpLNJwNGCqecDoi49Hq`，READY；[Vercel部署记录](https://vercel.com/z347365990gmailcoms-projects/space-atlas/4PuFneawMUpLNJwNGCqecDoi49Hq)。
- 部署来源提交：`b2d97344cb56924080af98f629591d32bdda5e52`。应用实现提交：`b38275363b7d004fb8bc94aeb1f014d1d67068ef`；其后提交为验收脚本、来源文档和发布标记。
- 工作分支：`codex/main-realism-performance-20260914`，从 `main` 的 `8446be90000e776779317c99c2de4eb0c0f3e946` 创建。没有合并或推送改动到 `main`，没有读取或参考废弃分支。
- [公开版本标记](https://space.colafun.xyz/release.json)记录应用实现提交；它不冒充后续发布记录的文档提交。

## 基础版本实际核验

全部报告、截图和下载保留在工作区 `test-results/`，发布专项在 `test-results/release/`；不包含凭据。以下均为实际运行结果。

| 项目 | 结果与证据 |
| --- | --- |
| 数值与构建 | 87/87测试通过；TypeScript/Vite生产构建通过。保留已有Three.js分包体积提示 |
| 科学与物理 | 603年份包、5431原始SPK对照点，最大编码差0.066720 km；359九落点独立天空对照、156个既有地平样本、170组IAU姿态、351组平均轨道转换；Apollo15、水星3:2及太阳角尺度通过。总误差与模型限制见验收矩阵 |
| 性能 | 同RTX 2080 Ti/Edge、空缓存、10Mbit/s/40ms、各3次：首屏可交互中位36.619→0.955秒，减少97.39%；首屏11张预览合计214978字节。星云四档实际开销、自动升降及原生后台证据见[性能验收](PERFORMANCE_VALIDATION.md) |
| 候选版本浏览器 | 四屏跨场景4/4、九落点×四屏36/36通过，含DPR1/3/2/2、实际canvas、变焦、键盘转向、暂停、日照、资料、照片及返回。报告 `candidate-integration/integration.json`、`candidate-landings/report.json`，成品截图已人工查看 |
| 最终候选资源 | 655个文件逐个与本地已测构建作SHA-256核对，全部一致，含所有603年份星历、JS/CSS、首屏预览、11种全景版本、物理定义与来源文件；18条资料链接、4条入口/重定向正常。报告 `final-candidate-http/report.json` |
| 正式主站 | 推广后无登录、无测试凭据，重新核对655个文件/18条链接/4条路由，并重跑四屏跨场景4/4；刷新、后退、暂停、设置/镜头恢复及canvas变化通过，无页面错误或场景启动外部服务请求。报告 `production-http/report.json`、`production-integration/integration.json` |
| 备用域名 | 未登录访问版本标记、三场景及根路由正常，三个场景入口JS哈希与构建一致。报告 `backup-domain.json` |
| 云图接口 | GET `/api/clouds`与观测图像均200，图像2048×1024、988706字节，观测时间明确为2026-09-09 12:00 UTC；未把该时间称为当前天气。不存在的接口返回结构化404。报告 `production-clouds.json` |
| 生产与回退状态 | Vercel API确认两个正式域名均指向上述新部署，上一版仍READY；临时测试访问凭据已全部撤销，原部署保护配置保持。报告 `production-state.json` |

候选浏览器操作针对 `01ce6ad` 构建；最终 `b2d9734` 构建只更正待办页的完成状态链接。两次构建655个被核验文件中，654个字节完全一致，唯一变化为 `TODO.md`，应用与数据没有变化；最终正式域名的四屏回归另行重跑通过。本记录后续提交仅更新仓库发布说明，不重新部署应用。

手机、平板、安全区均为桌面Edge视口模拟；原生后台验证为Windows Edge，计算可访问名称不代表运行了第三方屏幕阅读器。1 km要求针对JPL数据编码，不能作为全部天体、姿态、落点或食相精度保证。地形艺术补绘、固定阴影和平均模型的限制继续公开保留。

## 基础版本的更早回退点

上一生产部署 `dpl_2EHajH5Yann9H8gxQtrjn4JTCq2R` 已保留，来源为 `main` 的 `8446be90000e776779317c99c2de4eb0c0f3e946`；新版切换后再由API确认READY。

需要回退时，使用已授权的本机凭据执行：

```text
vercel rollback dpl_2EHajH5Yann9H8gxQtrjn4JTCq2R --scope z347365990gmailcoms-projects
```

命令认证从指定本机文件在进程内读取，不使用失效旧缓存，不将密钥写入仓库或日志。随后复核两个正式域名的部署ID及页面。旧部署的直接地址保留原登录保护，回退可用性依据READY状态与保留的部署ID；本次没有为演练而重新切回旧站。参见[Vercel回退命令](https://vercel.com/docs/cli/rollback)。
