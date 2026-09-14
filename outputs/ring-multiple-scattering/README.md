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

删掉显示标定因子后，环比改动前暗 7–8 倍（同一视角、同一日期）。改动前的亮度是显示标定的产物，
不是物理量；要恢复观感应调有说明的场景曝光，不再往反射率里塞常数。

## 未做到

完整的公里级 τ(r) 剖面。目标数据集 COUVIS_8001 在 `pds-rings.seti.org`，
本机对该节点**每个**路径都得到 HTTP 504（首页、`/ringocc/`、`/volumes/COUVIS_8001.tar.gz` 均如此，
下载尝试只收到 16 字节的错误页）。替代做法是把 PDS 大气节点列出的 7 条命名窄环并入环区表。
