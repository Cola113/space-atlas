# 四项动态效果的成品截图（2026-09-16）

四张图是 `npm run build` 后用 `server/index.js` 提供 `dist/`、按 2026-09-16 默认模拟日期抓的成品画面，
用于人工查看效果本身——自动门槛只验证着色器能编译、像素判据仍成立，不判断观感。

| 文件 | 效果 | 复现 |
| --- | --- | --- |
| `saturn-spokes.png` | 土星环辐条（放大三次后的取景） | `capture-saturn-zoom.mjs` |
| `mars-caps.png` | 火星极冠（按 L_s 的季节范围） | `capture-effects.mjs` |
| `ganymede-aurora.png` | 木卫三极光卵 | `capture-effects.mjs` |
| `triton-plume.png` | 海卫一氮气喷流 | `capture-effects.mjs` |

```bash
npm run build && PORT=5312 HOST=127.0.0.1 node server/index.js &
ATLAS_URL=http://127.0.0.1:5312 npx tsx outputs/effects-20260916/capture-effects.mjs
```

边界：辐条在 2026-09 这个日期本来就弱——环面只张开约 7°，而其方位向宽度按实测只有几度，
投影后很窄；上面那张是放大三次才看得清。它们最明显的季节是环面接近侧视的分点前后。

## 2026-09-16 复核：一项没生效

用户反馈"极光卵没看到、火星极冠没看出变化"后逐张查看，并做了像素量测。四项的真实状态：

| 效果 | 状态 | 依据 |
| --- | --- | --- |
| 土星环辐条 | 生效 | 放大三次的取景里可见径向暗纹（本目录 `saturn-spokes.png`） |
| 火星极冠 | 生效 | 南极有明显白冠（`diag-mars.png`，2026-09 的 L_s 正是南冠最宽、北冠最小的季节） |
| 海卫一氮气喷流 | **未确认** | 地标标记在，但粒子在该取景里看不见：南极位于球体下缘，喷流可能是亚像素或被球体遮挡；需要近观取景复核 |
| 木卫三极光卵 | **未生效** | 多次尝试都看不到；像素量测强蓝与偏蓝均为 0 |

排查过的原因（供下次接手）：球面材质在细节到达时会被替换，挂在旧材质上的 `onBeforeCompile` 会被无声丢弃——已改成逐帧核对材质身份并重挂；
`state.date` 是毫秒数，`Date.parse(date)` 得 NaN 会让驱动量变成 NaN——已改为 `new Date(date).getTime()`。
火星正是靠这两处修复才生效的；木卫三仍不渲染，`lights_fragment_end` 与 `emissivemap_fragment` 两个挂点都试过。
下一步建议：用已在球面上验证有效的 `map_fragment` 挂点先放一块**常量颜色**做二分（辐条那次就是这样定位的），确认补丁落地后再排 UV 纬度与挂点。
