import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

// Isolate shader motion from rotation/camera movement. Also compile the shared
// Lambert path used by the landing sky, verify cloud toggle, night side and seam.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL('../test-results/venus-weather/render/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = [];

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.route('**/__venus-weather-probe', route => route.fulfill({
    contentType: 'text/html',
    body: '<style>body{margin:0;background:black}</style>',
  }));
  await page.goto(base + '/__venus-weather-probe');

  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { patchVenusWeather, createVenusWeatherUniforms } = await import('/solar-system/src/venus-weather.js');
    const { bodyModels } = await import('/solar-system/src/body-models.js');
    const { createBodyGeometry } = await import('/solar-system/src/body-geometry.js');
    const { bindPhysicalSun } = await import('/solar-system/src/physical-lighting.js');
    const { bindSkyDepth } = await import('/solar-system/src/surface/sky-depth.js');

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(800, 800);
    renderer.setPixelRatio(1);
    document.body.append(renderer.domElement);

    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10);
    const map = await new THREE.TextureLoader().loadAsync('/solar-system/textures/2k_venus_atmosphere.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.anisotropy = 4;

    const uniforms = createVenusWeatherUniforms();
    const sun = new THREE.Vector3(), light = new THREE.DirectionalLight('white', 2.2);
    scene.add(light, new THREE.AmbientLight('white', 0.018));

    const materials = [
      new THREE.MeshStandardMaterial({ map, roughness: 1 }),
      new THREE.MeshLambertMaterial({ map }),
    ];
    for (const material of materials) {
      patchVenusWeather(material, uniforms);
      bindPhysicalSun(material, sun);
    }
    bindSkyDepth(materials[1], { value: 100000 }, { value: new THREE.Vector2(100, 20) });

    const mesh = new THREE.Mesh(createBodyGeometry(bodyModels.venus, new THREE.SphereGeometry(1, 128, 96)), materials[0]);
    scene.add(mesh);

    window.venusProbe = {
      render({ time = 0, progress = -1, pole = false, night = false, lambert = false, cloudVisible = 1, activity = 0 } = {}) {
        uniforms.uVenusTime.value = time;
        uniforms.uVenusProgress.value = progress;
        uniforms.uVenusCloudVisible.value = cloudVisible;
        uniforms.uVenusActivity.value = activity;

        const aim = pole
          ? new THREE.Vector3(0.02, 1, 0.03).normalize()
          : new THREE.Vector3(1, 0.08, 0.2).normalize();
        camera.position.copy(aim).multiplyScalar(4);
        camera.up.set(0, pole ? 0 : 1, pole ? -1 : 0);
        camera.lookAt(0, 0, 0);

        sun.copy(aim).multiplyScalar(night ? -1 : 1);
        light.position.copy(sun);
        mesh.material = materials[lambert ? 1 : 0];
        renderer.render(scene, camera);
      },
    };
  });

  async function render(name, options) {
    await page.evaluate(options => window.venusProbe.render(options), options);
    const png = await page.locator('canvas').screenshot();
    await writeFile(new URL(name + '.png', output), png);
    return sharp(png).removeAlpha().raw().toBuffer();
  }

  function difference(a, b) {
    let changed = 0, total = 0, sum = 0, largest = 0;
    for (let y = 100; y < 700; y++) {
      for (let x = 100; x < 700; x++) {
        const i = (y * 800 + x) * 3;
        const delta = Math.max(...[0, 1, 2].map(c => Math.abs(a[i + c] - b[i + c])));
        if (delta > 2) changed++;
        if (delta > largest) largest = delta;
        sum += delta;
        total++;
      }
    }
    return { changed, fraction: changed / total, mean: sum / total, max: largest };
  }

  // 1. Cloud motion check
  const start = await render('clouds-0', { time: 0 });
  const moved = await render('clouds-8', { time: 8 });
  const cloudMotion = difference(start, moved);
  console.log('cloudMotion', JSON.stringify(cloudMotion));
  assert.ok(cloudMotion.changed > 1000, 'clouds do not move independently of the planet');

  // 2. Fixed weather determinism check
  assert.ok((await render('clouds-0-repeated', { time: 0 })).equals(start), 'fixed weather state is not deterministic');

  // 3. Polar motion check
  const pole0 = await render('pole-0', { time: 0, pole: true });
  const pole8 = await render('pole-8', { time: 8, pole: true });
  const polarMotion = difference(pole0, pole8);
  assert.ok(polarMotion.changed > 500, 'polar cloud tracers do not move');

  // 4. Bounded cyclic advection boundary wrap smoothness (28s cycle)
  const left = await render('cycle-before', { time: 27.99 });
  const right = await render('cycle-after', { time: 28.01 });
  const wrap = difference(left, right);
  console.log('cycleWrap', JSON.stringify(wrap), 'vs motion', JSON.stringify(cloudMotion));
  assert.ok(wrap.mean < cloudMotion.mean * 0.08, 'bounded advection jumps at its cycle boundary');

  // 5. Activity wave enhancement
  const baseline = await render('wave-idle', { time: 10, activity: 0 });
  const active = await render('wave-active', { time: 10, activity: 1 });
  const activityDiff = difference(baseline, active);
  console.log('activityDiff', JSON.stringify(activityDiff));
  assert.ok(activityDiff.changed > 1000, 'activity wave does not enhance cloud patterns');

  // 6. Night side non-emission (must not glow on unlit hemisphere)
  const night0 = await render('night-baseline', { time: 10, night: true });
  const nightActive = await render('night-active', { time: 10, night: true, activity: 1 });
  const night = difference(night0, nightActive);
  console.log('nightDiff', JSON.stringify(night), 'limit', activityDiff.mean * 0.15);
  // A glow would move many pixels on the unlit side by a visible amount. Both halves of this check are
  // about magnitude, not about the mean, which rounding alone can move by a fraction of a level.
  assert.ok(night.max <= 8 && night.changed < activityDiff.changed * .05, 'weather or haze glows on the unlit hemisphere');

  // 7. Landing shared Lambert material compilation
  await render('landing-shared-material', { time: 0, lambert: true, pole: true });

  assert.deepEqual(errors, []);
  report.push({ cloudMotion, polarMotion, activityDiff, wrap, night });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
