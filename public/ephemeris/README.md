# 本地 JPL 星历

状态：已接入九个地表观景点并通过编码、姿态和独立地平天空数值验证；总览与地表已读取同一物理帧，全部科学及发布验收仍在进行。年份加载/失败重试及范围外二体外推由共享物理层提供，详见 [地表计算](../surface/README.md)。

| 系统 | JPL 原始来源 | 保留的 NAIF 目标 | 用途 |
| --- | --- | --- | --- |
| 土星 | [SAT441](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/sat441.bsp) | 602、606、699，相对6 | 土卫二、泰坦相对土星的位置 |
| 天王星 | [URA184 第3部分](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/ura184_part-3.bsp) | 705、799，相对7 | 米兰达相对天王星的位置 |
| 冥王星 | [PLU060](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/plu060.bsp) | 9、10相对0；901、999相对9 | 冥王星系统相对太阳、冥王星与卡戎相对系统质心的位置 |
| 谷神星 | [Horizons 生成的 SPK](https://ssd-api.jpl.nasa.gov/doc/horizons.html)（`EPHEM_TYPE=SPK`，目标 1 Ceres） | 20000001 相对 10 | 谷神星相对太阳的位置 |

前三个系统保留原始 J2000 赤道坐标、公里单位、TDB 秒及原生 Chebyshev 多项式阶数和时间段，没有从少量位置点重新拟合。谷神星不同：它没有覆盖 1900—2100 的现行 NAIF 原始多项式内核（`ceres_1900_2100.bsp` 已归档、止于 2100-01-01，且早于黎明号的轨道解），Horizons 能生成的 SPK 又是 MDA 记录（数据类型 1 与 21），本项目与 jplephem 的解算器都不读。因此它是**换一种表示**而非重新拟合轨道：由 CSPICE 在源文件上密集采样，再按与 NAIF 小行星星历相同的 32 天窗口、19 阶 Chebyshev 重新表达，逐窗记录源残差（最大 0.000063 公里）。数据说明与适用范围见各源同目录 `.cmt` 及 [NAIF 汇总](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/aa_summaries.txt)。年份按民用日历请求，文件两端多保留一天以覆盖时标偏移和边界计算。

1900—2100（包含完整2100年），每系统每年一个二进制包，共804包，合计约52.6 MiB（土星25.8、天王星15.4、冥王星10.2、谷神星1.2 MiB）；每次仅需加载当前系统与年份，并缓存、预取邻年。前三个系统原始内核的所需段通过经验证的 HTTP Range 提取，私有缓存保留在忽略提交的 `data/jpl/`。`manifest.json` 记录源URL、提取文件SHA-256、每年包SHA-256、字节数及每个源段的编码误差界，谷神星条目另记 Horizons 查询与响应摘要。

重建：前三个系统用 `scripts/build-ephemeris.py --download-only` 配合 `scripts/build-ephemeris.py`；谷神星用 `scripts/build-small-body-ephemeris.py --refresh`，两者都只写年份包与清单，不调用浏览器。

## 精度界限

只量化误差满足保守上界小于0.1公里的源段使用32位浮点数，其余保留64位。由每个原始多项式系数的量化差求和，并使用 `|Tₙ(x)| ≤ 1`，计算全时间段的误差上界；位置相加/相减时累加各段上界。当前单段最大界约0.086公里，组合位置的编码误差小于1公里。谷神星的源多项式系数按同一界判断后需保留64位（界约23.7公里，远超阈值），故该系统的年份包为双精度；表格中各系统仍按段分别记录实际精度。

浏览器所用的 JavaScript 解算器在全部804包、7240个历史/未来/年份边界/非中点时刻，与参考解算结果对照，最大差约0.067公里。对土星、天王星、冥王星三系参考实现是 jplephem 对原始 SPK 的记录解算；对谷神星是 CSPICE 对 Horizons 源 SPK 的采样值。这是**编码与解算误差**，不是对 JPL 轨道解绝对精度作1公里承诺，也不包括时间转换、卫星姿态、地形或地球观测资料的不确定性。

卫星姿态独立取自 [NAIF PCK00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)，提取所有适用极轴、零经线和周期项；代码未用主星方向强制设置姿态。34个适用卫星及小天体、170组姿态矩阵与 CSPICE 独立输出对照。月球及主要行星继续保留 Astronomy Engine 模型；尚未额外加入非刚体物理天平动。

1972年前以UT近似民用日期，经Astronomy Engine的ΔT模型获得TT；1972年后使用 [NAIF 闰秒表](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls) 转TT，未来未知闰秒沿用最后已知值。TT至TDB使用NAIF的周期项。地球自转的UT1以UTC近似。历史/未来时间不能据此用于精密事件预报。

## 重建

`scripts/build-ephemeris.py` 使用 numpy、requests、jplephem 2.24；`scripts/build-iau.py` 另需 spiceypy 8.2.0（CSPICE N0067）。安装在忽略提交的专用环境 `data/ephemeris-tools/`，不修改浏览器依赖。两个脚本不会使用本机云服务凭据。

执行两个构建脚本，再运行 `npx tsx --test solar-system/tests/ephemeris.test.js solar-system/tests/orientation.test.js`。基础星历文件随站发布，运行时不调用JPL网络服务。

二进制格式：8字节 `ATLEPH01`，两个小端uint32分别为JSON头长度和数据长度；头部UTF-8并补齐8字节，数据为按记录/XYZ/升幂排列的Chebyshev系数。头部保留每段起点、间隔、阶数、数量、32/64位精度与字节偏移。损坏、错误年份和缺失数据必须作为加载失败处理。


## 总览与地表共用

总览和九个落点读取同一个日期及缓存版本的物理帧。总览的放大半径和各轨道距离缩放只存在于显示变换；不会影响地表角直径或入射阳光方向。必要年份尚未加载时对应天体隐藏，相关观景暂停推进时间并提供重试，不能先用圆轨道填充再冒充完整星历。

地球姿态采用 Greenwich apparent sidereal time（Astronomy Engine `SiderealTime`）及 `Rotation_EQD_EQJ`，与主要行星的通用 IAU 经线计算分开。地球 `RotationAxis` 的特殊旋转角原点不能直接当作其报告极轴的 IAU 结点经线角；UT1=UTC 和未采用极移的限制仍适用。日照是几何光线，不加入光行时、像差、折射或精密辐射传输。
