# 天体运动与外形模型

2026-09-12：目录包含 58 个天体，其中 43 颗为卫星。展示大小、轨道间距和形状夸张与资料卡中的物理半径独立；不存在由渲染半径反推公里数的换算。基础物理值集中在 `src/physical-scale.js`，特殊运动与外形集中在 `src/body-models.js`。

## 自转和潮汐锁定

全部运动读取同一模拟日期，因此暂停、倒放和恢复日期保持一致。“固定自转”优先冻结所选天体的全部自转轴。

| 天体 | 采用的运动 | 来源与说明 |
| --- | --- | --- |
| 鸟神星 Makemake | 22.8266 小时 | [Hromakina 等，2019](https://arxiv.org/abs/1904.03679)：采用双峰解，仍存在约 11.4 小时的单峰解释。 |
| 妊神星 Haumea | 3.915341 小时 | [恒星掩星研究](https://arxiv.org/abs/2006.03113)，快速旋转的三轴椭球。 |
| 阋神星 Eris | 15.7859 天，朝向阋卫一 | [Szakáts 等，2023](https://arxiv.org/abs/2211.07987)、[Bernstein 等，2023](https://arxiv.org/abs/2303.13445)：采用与卫星同步的现代结果，未沿用旧的约 26 小时估计。 |
| 土卫九 Phoebe | 约 9.3 小时，独立自转 | [NASA](https://science.nasa.gov/resource/phoebe/)；公转逆行标志与大于 90° 的倾角只反转一次。 |
| 木卫六 Himalia | 7.7819 小时 | [DLR 的原始测光研究](https://elib.dlr.de/77110/)，以测得的会合自转周期近似展示。 |
| 海卫二 Nereid | 11.594 小时 | [Kiss 等，2016](https://arxiv.org/abs/1601.02395)。 |
| 土卫七 Hyperion | 约 13 天尺度的多轴翻滚 | [NASA](https://science.nasa.gov/saturn/moons/hyperion/)。绝对日期驱动的非规则姿态示意，不是混沌动力学求解或真实朝向预测。 |
| 冥卫五 / 二 / 四 / 三 | 3.24 / 1.83 / 5.31 / 0.43 天附近的独立翻滚 | [NASA 冥王星数据表](https://nssdc.gsfc.nasa.gov/planetary/factsheet/plutofact.html?level=1)、[新视野号研究](https://ntrs.nasa.gov/citations/20170002512)。翻滚是展示性变化，不模拟精确极轴。 |
| 妊卫一 Hiʻiaka | 约 9.8 小时 | [Hastings 等，2016](https://arxiv.org/abs/1610.04305)。 |

冥王星与冥卫一互相保持同面相向，自转更新不再覆盖潮汐朝向。四颗小卫星围绕主星和冥卫一的共同质心运行，参见 [NASA](https://science.nasa.gov/blogs/new-horizons/2015/10/05/plutos-small-moons-nix-and-hydra/)。冥卫五对应 Styx、冥卫二对应 Nix、冥卫三对应 Hydra、冥卫四对应 Kerberos；名称参照 [中科院国家空间科学中心](https://www.nssc.cas.cn/kxcb/kpwz/qysm/201506/t20150610_4371558.html)。

其余卫星采用同步自转示意。妊卫二的自转尚未采用可靠测定值，阋卫一也以同步自转近似，资料中明确注明；这不是关于全部卫星均已测得潮汐锁定的声明。各自公转平面、相位和圆轨道均为展示模型，不是精密星历。

## 环、轮廓和共轨道

- 妊神星采用最长轴归一化后的 `[1, 0.442, 0.734]` 椭球，绕最短轴旋转。窄环在赤道平面，半径约为最长半轴的两倍，宽度适度放大，并加入微弱的展示补光以利于屏幕辨认。依据 [2017 年掩星结果](https://arxiv.org/abs/2006.03113)；环为几何示意，不声称具有土星环的粒子或阴影模型。
- 天卫一至四恢复近球形轮廓，参照 [NASA 天王星卫星资料](https://science.nasa.gov/uranus/moons/)。土卫十五 Atlas 与土卫十八 Pan 加入赤道隆起几何，参照 [NASA 卡西尼图像说明](https://science.nasa.gov/resource/saturns-saucer-moons/)。其它不规则形状只表达轮廓，不是高程重建。
- 土卫十 Janus 与土卫十一 Epimetheus 的内外轨道约每四年交换一次，参照 [NASA](https://science.nasa.gov/saturn/moons/janus/)。采用连续解析马蹄形示意：相对经度往返、径向位置交换、最小角间距保持非零；轨道差放大，轨道线随之移动。未求解相互引力，交换日期未与实际交会历表校准。

## 新增卫星与资料半径

妊卫一、妊卫二的公转周期分别取 49.462 天、18.2783 天，平均轨道尺寸约 49,880 km、25,657 km，相互轨道倾角展示为约 13°。半径约 160 km 与 80 km 是假设水冰密度下的估计，来源为 [Ragozzine 与 Brown，2009](https://arxiv.org/html/0903.4213v1)。阋卫一取 15.7859 天、37,273 km 和半径估计 350 km，参照 [阋神星自转与内部结构研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC10651115/)。

三颗新卫星没有完整地表地图：妊卫一、妊卫二共享现有妊神星艺术贴图，阋卫一共享现有天卫二艺术贴图。详情显示“共享艺术地表 / 非实测地图”，没有生成或新增任何实测地貌。现有 28 张独立艺术重绘地图仍保留原始分辨率和来源记录。

已有卫星半径以 [JPL 物理参数表](https://ssd.jpl.nasa.gov/sats/phys_par/)为主，包括木卫六 85 km、土卫十 89.2 km、土卫十一 58.2 km、土卫十七 40.6 km、土卫十八 14 km。冥王星小卫星的平均半径取 JPL 值；非球形物体的不同等效半径定义或历史资料可能不同。三颗矮行星沿用 [NASA 鸟神星](https://science.nasa.gov/dwarf-planets/makemake/)、[妊神星](https://science.nasa.gov/dwarf-planets/haumea/)、[阋神星](https://science.nasa.gov/dwarf-planets/eris/)简介的近似平均尺寸。

`npm test` 检查全部天体的非静止运动、资料尺寸与贴图可读性，并覆盖互锁、逆行、独立自转、固定全部自转轴、倒放、质心、共轨道避碰、赤道隆起及妊神星系统。
