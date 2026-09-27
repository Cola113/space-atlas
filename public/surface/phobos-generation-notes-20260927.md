# 火卫一两处全景：来源与交付边界

## 原始交付

Antigravity 于 2026-09-27 交付 `phobos-60E-raw.png`、`phobos-311E-raw.png` 及逐张提示词。接入方为 Codex。原始报告位于私有工作目录 `atlas-work/refs/phobos-20260927/out/final.md`；本文件摘录可公开的事实，不包含凭据或完整 API 请求/响应。逐张 SHA-256、原始尺寸及交付尺寸保存在同目录 `landings-provenance.json`。

- 生成工具：Antigravity `generate_image`；回执没有提供底层模型名称，未核验，不能继承项目默认模型为实际模型。
- 实际请求画幅：`16:9`。工具可选项不含 `2:1`；没有明确宽高像素或质量参数的可核验回执，因此 `requestedSize`、`requestedQuality` 记为 `null`。
- 实际返回：两张均为 1376 × 768，非原生 2:1、非原生 4K；没有做过 AI 放大。发布用 3840 × 1920 是本地 Lanczos 重采样，不产生新原生细节。
- 两份实际提示词按原文保存为 `phobos-60e-prompt.txt`、`phobos-311e-prompt.txt`。

## 轨道形貌参考

火卫一没有地面全景实拍。这两张图是轨道影像参考重绘，无法代替实测地形、测高或局部法线。参考影像均为 MRO/HiRISE 2008-03-23 观测，署名 NASA/JPL-Caltech/University of Arizona；其彩色合成、轨道视角和原照明没有被当作站立点的实测数据。

- HiRISE PSP_007769_9010：<https://static.uahirise.org/images/2008/details/phobos/PSP_007769_9010_IRB.jpg>。下载副本 3374 × 3300，SHA-256 前 16 位 `9ecffab886c13c61`。
- 同一观测彩色副本：<https://upload.wikimedia.org/wikipedia/commons/5/5c/Phobos_colour_2008.jpg>。3500 × 3300，SHA-256 前 16 位 `871c9028fdda5d69`。
- 斯蒂克尼局部：<https://upload.wikimedia.org/wikipedia/commons/5/59/Stickney_mro.jpg>。1836 × 1362，SHA-256 前 16 位 `b4fb7e7164961a39`。

## 本地处理与限制

仅对两张新素材运行 `prepare-landing-sites.py --only phobos-60e,phobos-311e`。在原始像素中逐列追踪真空地平轮廓，仅移除轮廓上方的黑天，保留轮廓下方的暗色坑壁和阴影；再沿用 `landing_texture_lib.py` 的重采样、窄幅接缝融合、天底平滑与 WebP 编码。没有新画图、补绘地貌或生成噪声。太阳、火星与星空由程序独立按日期渲染。

原始图的左右边缘并非严格周期闭合，本地融合处理显示接缝，不能声称恢复了真实 360° 地形。60°E 近景沟槽存在艺术透视与深度夸张；311°E 构图更接近从坑内一侧看对壁，不能当作经测量闭合的环视地形。全景中的近景石块、微坑、坑壁和沟槽位置均属重绘，纹理方向与真实地理方位没有测量配准。

两个站立点在项目球面模型中的火星圆盘高于地平线；这不等于斯蒂克尼真实坑底能看到整颗火星。重绘坑壁会遮住部分天空，真实坑壁、局部法线及贴图经线仍需进一步核验。
