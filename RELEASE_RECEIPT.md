# 发布记录

2026-09-14 发布完成。共享物理与九落点天空、跟随自转、太阳系分批加载、星云四档与自动挡、全站按钮布局均已实施，并完成数值、构建、浏览器及线上验收。逐项范围与精度边界见 [验收矩阵](RELEASE_ACCEPTANCE.md)。

## 线上版本

- 正式站：[space.colafun.xyz](https://space.colafun.xyz/)。备用：[space-atlas-pi.vercel.app](https://space-atlas-pi.vercel.app/)。
- 生产部署：`dpl_4PuFneawMUpLNJwNGCqecDoi49Hq`，READY；[Vercel部署记录](https://vercel.com/z347365990gmailcoms-projects/space-atlas/4PuFneawMUpLNJwNGCqecDoi49Hq)。
- 部署来源提交：`b2d97344cb56924080af98f629591d32bdda5e52`。应用实现提交：`b38275363b7d004fb8bc94aeb1f014d1d67068ef`；其后提交为验收脚本、来源文档和发布标记。
- 工作分支：`codex/main-realism-performance-20260914`，从 `main` 的 `8446be90000e776779317c99c2de4eb0c0f3e946` 创建。没有合并或推送改动到 `main`，没有读取或参考废弃分支。
- [公开版本标记](https://space.colafun.xyz/release.json)记录应用实现提交；它不冒充后续发布记录的文档提交。

## 实际核验

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

## 回退

上一生产部署 `dpl_2EHajH5Yann9H8gxQtrjn4JTCq2R` 已保留，来源为 `main` 的 `8446be90000e776779317c99c2de4eb0c0f3e946`；新版切换后再由API确认READY。

需要回退时，使用已授权的本机凭据执行：

```text
vercel rollback dpl_2EHajH5Yann9H8gxQtrjn4JTCq2R --scope z347365990gmailcoms-projects
```

命令认证从指定本机文件在进程内读取，不使用失效旧缓存，不将密钥写入仓库或日志。随后复核两个正式域名的部署ID及页面。旧部署的直接地址保留原登录保护，回退可用性依据READY状态与保留的部署ID；本次没有为演练而重新切回旧站。参见[Vercel回退命令](https://vercel.com/docs/cli/rollback)。
