# 环系数据补齐的本轮证据

2026-09-15。对应[天体模型](../../solar-system/BODY_MODELS.md)里「环的多次散射」「环的相函数与粒子颜色」
「其余行星的环系」三节。**没有修改主应用以外的任何文件**；这里的脚本只读应用、截图与量测。

## 怎么跑

```bash
npm run dev            # 另开一个终端
ATLAS_URL=http://127.0.0.1:5173 node outputs/ring-multiple-scattering/capture.mjs
```

## 逐项证据

| 脚本 | 做什么 | 结果 |
| --- | --- | --- |
| `capture.mjs` | 土星四个视角（桌面环系、手机、短横屏、北极）截图并统计环区像素 | 四个视角 0 运行错误 |
| `compare-brightness.mjs` | 与改动前验收状态 `app-ring-final` 同一视角、同一日期逐像素比较 | 见下 |
| `measure-rings.mjs` | 在四个只含环的取样框里算平均亮度比 | C/B 环带 0.116、A 环弧 0.136、右环 0.395 |
| `capture-systems.mjs` | 四个环系各截一张，收集 pageerror 与 console error | 四个环系 0 运行错误 |
| `capture-close.mjs` + `boost2.mjs` | 拉远到看得见整个环系的视距，再用极端对比度增强 | 天王星、海王星的窄环按实测宽度可见 |
| `review-viewpoints.mjs` + `measure-viewpoints.mjs` | 2002 北至点、2017 南至点、2025 春分三个日期 | 见[天体模型](../../solar-system/BODY_MODELS.md#环的倾角透明度遮挡与光照复核) |

## 显示后果

环的**物理反射率**比改动前低约 5 倍（改动前是「单次散射 × 10」，B 环 I/F 达 0.75）。
但**屏幕上的环比 2026-09-13 的验收状态亮约 2.4 倍**，因为改动前环的底色是手选的十六进制值
乘环贴图 RGB，线性空间里只有约 0.03，而现在是实测粒子颜色的约 0.85。
判断依据是相对行为，不是屏幕亮度：色调映射未按绝对光度标定。

早先这里记过「暗 7–8 倍」，那个量测复现不出来（同一次改动前后两次运行给出完全相同的数字，
说明读到了陈旧图像），已按可复现的框内量测改写。公里级剖面前后的对比另外做过一次 A/B：
把工作区切到 `8f217c3` 起一个服务、用同一个脚本截图，四个取样框的亮度差在 2%–9% 之间，
与模型算出的 1.0–1.07 倍一致。

## 未做到

无。公里级 τ(r) 剖面已从 PDS `COUVIS_8001` 取到（见[天体模型](../../solar-system/BODY_MODELS.md#公里级光学厚度剖面)）：
`pds-rings.seti.org` 在本机对每个路径都返回 HTTP 504，但同节点的 `opus.pds-rings.seti.org` 可达，
且把卷文件映射在 `/holdings/` 下，因此可以按单个产品下载 1 km 剖面而不必取 438 MB 整卷。
残留近似（单次掩星、仰角依赖、B 环局部饱和、每区算术平均）写在文档里。

## 亚像素环的斑点

用户 2026-09-15 报告：天王星球面上有一条暗线，线上和旁边散布着斑点。
`compare-uranus-line.mjs` 复现这个取景并量出成因与修法效果，`measure-uranus-angle.mjs` 量出应用自己的
环面张角（天王星 28°，所以那条线是环系内缘扫过球面）。修法在 `dynamics.js` 的 `RING_MIN_PIXELS`，
验收脚本是 `scripts/verify-ring-thin-coverage.mjs`。

对比图：`uranus-ring/line-before.png`（斑点）与 `uranus-ring/line-fixed.png`（连续线），
以及 `uranus-ring/crop-before.png` / `crop-after.png` 的同框裁剪。
判据不是亮度——随机采样的**期望**通量是守恒的，问题在方差；所以量的是逐行凹陷的离散度。

## 图片不进版本库

`outputs/**/*.png`、`*.jpg` 已加入 `.gitignore`：这些截图由上面列出的脚本重新生成，
进分支只会把 diff 淹没在几万行的二进制里。脚本、`report.json` 与这份说明保留在版本库内，
量测数字也都在脚本输出里可以复现。跑一遍脚本即可得到文档引用的那些图。

## 未做到

完整的公里级 τ(r) 剖面。目标数据集 COUVIS_8001 在 `pds-rings.seti.org`，
本机对该节点**每个**路径都得到 HTTP 504（首页、`/ringocc/`、`/volumes/COUVIS_8001.tar.gz` 均如此，
下载尝试只收到 16 字节的错误页）。替代做法是把 PDS 大气节点列出的 7 条命名窄环并入环区表。
