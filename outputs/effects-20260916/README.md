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
