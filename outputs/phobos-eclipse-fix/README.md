# 火卫一日食与默认时刻：独立复算

本包从 d28842d 继续。上一版把两处落点的 **2026-09-27 00:39 UTC** 记为无食，是错误结论，已作废。根因是 sunHiddenByParent 用 atan(r/d) 计算球体视半径，低估了火星遮挡边界；旧测试又调用同一个错误判据，不能独立发现问题。

## 口径与独立证据

独立路径是 scripts/build-phobos-eclipse-reference.py：不导入应用的位置、姿态、时间或日食函数；不把 Hermes 的结果作为输入。直接向 Horizons 获取火星→火卫一与火卫一→太阳几何向量，显式设置 TIME_TYPE=UT、REF_PLANE=FRAME、REF_SYSTEM=ICRF、VEC_CORR=NONE、OUT_UNITS=KM-S；用 CSPICE、PCK00011、NAIF0012 计算落点位置和太阳高度。火星方向取第一个向量的负值。

先独立取得 UTC 结果后，只读检查 Hermes 的两个脚本，发现它们均没有 TIME_TYPE。再发出省略该参数的独立请求，重现了 Hermes 的 20.09° 和 9412.5 km。向量表响应头明确标注 TDB，不能把这一日历标签当作 UTC。

| 火卫一中心几何 | 显式 2026-09-27 00:39 UTC | 省略 TIME_TYPE 的 00:39 标签 |
|---|---:|---:|
| 实际时间尺度 | UTC | TDB（约等于 00:37:50.818 UTC） |
| 火星距离 km | 9414.582574 | 9412.457334 |
| 日–火中心夹角 ° | 20.99319949 | 20.09744201 |
| PCK 火星赤道球视半径 ° | 21.14547587 | 21.15047966 |
| 太阳视半径 ° | 0.17152965 | 0.17152972 |
| 圆面完全分离门槛 ° | 21.31700552 | 21.32200938 |

太阳半径取 PCK 的 695700 km，太阳距离约 232383928 km；因此此处太阳视半径是 0.17153°，不是任务书估计的 0.090°。21.236° 示例不符合这组独立输入，正式回归使用 **21.31700552° ± 0.002°**，没有改科学数据去迎合示例。

项目仍用火星平均半径 3389.5 km；PCK 赤道球取 3396.19 km，作为更大的保守遮挡边界。二者分别报告，没有把中心观测、地表观测、平均球和赤道球混在一起。实际 00:39 UTC：60°E 在两种球体口径下均为全食，311°E 均为偏食；两处都没有完全出食。中心夹角小于主星视半径只能说明太阳中心被遮挡；要判断全食，仍需扣除太阳自身视半径。

资料来源：

- [JPL Horizons API 参数](https://ssd-api.jpl.nasa.gov/doc/horizons.html)：向量时标、坐标、几何修正及查询参数。
- [Horizons 手册](https://ssd.jpl.nasa.gov/horizons/manual.html)：向量表默认 TDB。
- [NAIF PCK00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc)：半径与姿态。
- [NAIF0012 闰秒核](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls)：UTC/TDB 转换。

## 新时刻与余量

以 2026-09-27 00:00 UTC 为起点，每分钟搜索太阳高度 > 8°、无任何日面交叠、距离完全出食至少 12 分钟的候选；验收要求仍是至少 10 分钟。项目路径和独立路径选择一致：

| 落点 | 新 site.date（UTC） | 项目太阳高度 ° | 独立太阳高度 ° | 独立保守出食后至少 |
|---|---|---:|---:|---:|
| 1°N / 60°E | 2026-09-27 04:52:00 | 8.548076 | 8.547864 | 252.4833 分钟 |
| 1°N / 311°E | 2026-09-27 00:52:00 | 69.453929 | 69.453682 | 12.6167 分钟 |

60°E 不能只将旧时刻顺延十几分钟：出食后太阳很快低于 8°，因此要等下一次满足高度条件的日照窗口。311°E 在本次出食后即可选择。两处落点进入时仍继承总览日期、速率与播放状态；这里只修资料兜底日期，没有新增默认时刻导航。

| 完全出食（UTC，独立一秒夹逼） | 项目平均半径球 | PCK 赤道半径球 |
|---|---|---|
| 60°E | 00:39:26–00:39:27 | 00:39:30–00:39:31 |
| 311°E | 00:39:18–00:39:19 | 00:39:22–00:39:23 |

时间夹逼只是这些模型的数值求根精度，不是实际天象的绝对预报精度。独立查询每分钟扫描出食至候选的区间；回归另检查新时刻之前十分钟的 41 个项目样本及 11 个独立样本。球体近似不包含真实椭球边缘、局部地形、折射或光行差。

## 回归为何能发现旧错误

- 通过公共 sunHiddenByParent 二分测量判据实际门槛，与独立参考比对，避免只测正确的 angularDiameter 却放过错误的调用者。
- 断言已作废的 00:39 在两处落点都在食中；旧 atan 会返回 false。
- 检查日面偏食交叠与完全分离两侧，避免只检查太阳中心。
- 隔离复制生产代码和三项回归，仅将判据换回 atan：三项全部失败；原文件不变。新的安全时刻当然也会通过过窄的旧判据，因此不能单靠“新时刻无食”证明根因已修。

## 审计范围与未改变项

全部 21 处登记落点：14 处有非太阳主星遮挡对象，另 7 处 parent=Sun 不适用本函数。逐处旧/新视半径、太阳项增量、阈值增量及默认时刻结论见 [影响表](satellite-eclipse-audit.md) 和 [原始指标](satellite-eclipse-audit.json)。基线只有两处火卫一翻转，其它 19 处没有因此需要改日期的落点。配置文件逐字对比确认只替换两处火卫一日期，贴图、半径、姿态和轨道定义与 d28842d 无差异。

未修改其它落点资料与素材、地貌、太阳方向或全局时间。SurfaceSky.solarVisibility 原先已经使用 angularDiameter 的 asin，不需要更改；本次使寻找日照的辅助判据与现有照明半径一致。未扩展全局 nextDaylight 的筛选策略：十分钟最低余量只用于本次资料日期选择及回归。

火卫一确实有日食季。原候选报告记录的 **01-01—03-03、06-07—12-31** 继续保留；本包没有重算全年季节边界，也不因修复默认时刻而删除日食。

## 复算与产物

1. 使用现有 data/ephemeris-tools/Scripts/python.exe 运行 scripts/build-phobos-eclipse-reference.py --download；缺少响应时才联网。原始响应位于忽略目录 data/phobos-eclipse-audit/，可检查实际 UTC/TDB 表头。
2. npx tsx scripts/verify-phobos-default-moments.mjs：重建本目录与 test-results/ 的默认时刻 JSON、全落点影响 JSON，检查配置修改范围。
3. npx tsx --test solar-system/tests/surface-eclipse.test.js solar-system/tests/phobos-landings.test.js：离线读取固化的独立样本。
4. node scripts/verify-surface-eclipse-mutation.mjs：只在临时副本注入旧公式，报告与日志写入 test-results/，结束删除临时源码。

独立参考、查询参数、响应头和摘要哈希保存在 solar-system/tests/phobos-eclipse-reference.json。新默认时刻证据见 [phobos-default-moments.json](phobos-default-moments.json)。完整测试、构建、浏览器验收及分段提交结果见仓库根 final.md 与 test-results/PROGRESS-phobos-eclipse-fix.md。
