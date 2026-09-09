# 星际图鉴 · Space Atlas

可交互的太阳系与黑洞观测站。首页直接进入太阳系，点击左上角的「星际图鉴」切换目的地。两个场景保留各自的三维渲染、相机和观测工具，切换时保存当前标签页的观察位置及设置。

## 运行

需要 Node.js 22.12 或更高版本，以及支持 WebGL 2 的浏览器。

```sh
npm ci
npm run dev
```

打开终端给出的地址。`/solar-system/` 与 `/black-hole/` 都支持直接访问、刷新和浏览器前进后退。切换菜单支持鼠标、触摸、键盘和全屏；减少动态效果的系统设置会关闭页面转场动画。

```sh
npm test
npm run build
npm start
```

正式服务默认位于 `http://127.0.0.1:3000`，同时提供构建后的网页和地球云图接口。`PORT`、`HOST` 可覆盖监听配置；对外托管时使用 `HOST=0.0.0.0`，并在前面配置 HTTPS 反向代理。

云图会在运行期间自动检查更新；`CLOUD_CACHE_DIR` 可指定持久缓存目录，默认为 `data/clouds/`。缓存不提交到 Git。数据源暂不可用时，接口返回状态并保留已有缓存，前端说明数据是否过期，不用模拟云伪装成实时观测。

仅上传 `dist/` 可提供两个三维场景，但**卫星云图功能还需要 Node 服务**，或将 `/api/clouds` 代理到该服务。当前构建面向域名根路径，不配置到任意深层子目录。

## 结构

```text
platform/                  场景注册表、统一导航、会话状态
solar-system/src/          太阳系、行星与卫星、动态与观测云层
solar-system/server/       EUMETSAT 云图处理与缓存
black-hole/src/            Schwarzschild 光线积分、吸积盘、截图与画质
server/                    同域静态网页与云图 API 服务
public/shared/             共用的合成星空
public/solar-system/       行星与卫星纹理
public/licenses/           第三方素材及库许可证
tests/                     平台状态与正式服务测试
scripts/                   星空生成和浏览器集成验证
```

采用多入口构建和页面级场景隔离。每页只导入本场景引擎，Three.js、图标和星空共享缓存；没有 iframe，也不会同时运行两套渲染循环。离开时保存场景会话并释放 GPU 资源。返回缓存页面时重新建立渲染上下文，按保存状态恢复；更换横竖屏时重新适配距离。太阳系卫星观测仍使用当前观测时间，黑洞保留其独立的无量纲模拟时间，两者不强行共享坐标或时间单位。

未来增加场景：新增独立的 `<scene-id>/index.html` 和引擎目录，在 `platform/scenes.js` 注册路径与能力，调用 `mountNavigation`，接入 `readSession` / `rememberScene`，提供退出时的清理。注册表同时生成构建入口和导航，新增模块不需要修改已有场景的渲染代码。新增跨场景功能应通过能力列表选择支持的场景；数据请求放入服务层，避免在场景着色器或导航中耦合接口。

## 验证

`npm test` 覆盖原有云图、日照、黑洞物理关系、计时和画质逻辑，以及新增的状态隔离和正式路由。`npm run build` 包含黑洞与平台 TypeScript 检查。

服务启动后执行 `npm run test:browser`，默认访问 `http://127.0.0.1:5190`；可通过 `ATLAS_URL` 覆盖。验证桌面、手机与矮视口、页面切换、状态恢复、按需加载及画布像素变化。截图与结果在 `test-results/`，不提交仓库。

## 数据与边界

太阳系轨道间距和天体大小采用展示比例，动态活动部分为示意；卫星云图带有来源、时间与缺测说明。黑洞使用非旋转 Schwarzschild 模型，不是某个已观测黑洞的实时画面。背景是固定种子生成的合成星空，不是真实星表。

完整科学说明与素材来源见 [太阳系说明](solar-system/README.md) 和 [黑洞说明](black-hole/README.md)。行星贴图含 Solar System Scope 的 CC BY 4.0 素材，以及 NASA/JPL 等影像加工；详细作者、来源链接与修改方式均保留。共享星空可通过 `node scripts/generate-stars.mjs` 重建。宣传视频、录制帧、临时日志、云图缓存与凭据不属于此应用源码。
