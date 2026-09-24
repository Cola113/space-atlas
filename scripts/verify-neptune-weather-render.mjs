import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL('../test-results/neptune-weather/render/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await launchBrowser();

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__neptune-weather-probe', route => route.fulfill({
    contentType: 'text/html', body: '<style>body{margin:0;background:black}</style>',
  }));
  await page.goto(base + '/__neptune-weather-probe');

  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { patchNeptuneWeather, createNeptuneWeatherUniforms } = await import('/solar-system/src/neptune-weather.js');
    const { bodyModels } = await import('/solar-system/src/body-models.js');
    const { createBodyGeometry } = await import('/solar-system/src/body-geometry.js');
    const { bindPhysicalSun } = await import('/solar-system/src/physical-lighting.js');
    const { bindSkyDepth } = await import('/solar-system/src/surface/sky-depth.js');

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(800, 800);
    renderer.setPixelRatio(1);
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 10);
    const map = await new THREE.TextureLoader().loadAsync('/solar-system/textures/2k_neptune.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.anisotropy = 4;
    const uniforms = createNeptuneWeatherUniforms();
    const sun = new THREE.Vector3();
    const light = new THREE.DirectionalLight('white', 2.2);
    scene.add(light, new THREE.AmbientLight('white', .018));
    const materials = [new THREE.MeshStandardMaterial({ map, roughness: 1 }), new THREE.MeshLambertMaterial({ map })];
    for (const material of materials) {
      patchNeptuneWeather(material, uniforms);
      bindPhysicalSun(material, sun);
    }
    bindSkyDepth(materials[1], { value: 100000 }, { value: new THREE.Vector2(100, 20) });
    const mesh = new THREE.Mesh(createBodyGeometry(bodyModels.neptune, new THREE.SphereGeometry(1, 128, 96)), materials[0]);
    scene.add(mesh);
    window.neptuneProbe = {
      render({ time = 0, progress = -1, activity = 0, night = false, lambert = false } = {}) {
        uniforms.uNeptuneTime.value = time;
        uniforms.uNeptuneProgress.value = progress;
        uniforms.uNeptuneActivity.value = activity;
        const aim = new THREE.Vector3(1, .08, .2).normalize();
        camera.position.copy(aim).multiplyScalar(4);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        sun.copy(aim).multiplyScalar(night ? -1 : 1);
        light.position.copy(sun);
        mesh.material = materials[lambert ? 1 : 0];
        renderer.render(scene, camera);
      },
    };
  });

  async function render(name, options) {
    await page.evaluate(options => window.neptuneProbe.render(options), options);
    const png = await page.locator('canvas').screenshot();
    await writeFile(new URL(name + '.png', output), png);
    return sharp(png).removeAlpha().raw().toBuffer();
  }
  function difference(a, b) {
    let changed = 0, sum = 0, max = 0;
    const total = 600 * 600;
    for (let y = 100; y < 700; y++) for (let x = 100; x < 700; x++) {
      const i = (y * 800 + x) * 3;
      const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      if (delta > 2) changed++;
      sum += delta;
      max = Math.max(max, delta);
    }
    return { changed, fraction: changed / total, mean: sum / total, max };
  }

  const start = await render('clouds-0', { time: 0 });
  const moved = await render('clouds-8', { time: 8 });
  const cloudMotion = difference(start, moved);
  console.log('cloudMotion', JSON.stringify(cloudMotion));
  assert.ok(cloudMotion.changed > 1000, 'clouds do not move independently of rotation');

  const repeated = await render('clouds-0-repeated', { time: 0 });
  const determinism = { equal: repeated.equals(start), changed: difference(repeated, start).changed };
  console.log('determinism', JSON.stringify(determinism));
  assert.ok(determinism.equal, 'fixed weather state is not pixel deterministic');

  const left = await render('cycle-before', { time: 27.99 });
  const right = await render('cycle-after', { time: 28.01 });
  const wrap = difference(left, right);
  console.log('wrap', JSON.stringify(wrap), 'cloudMotion', JSON.stringify(cloudMotion));
  assert.ok(wrap.mean < cloudMotion.mean * .08, 'bounded advection jumps at its period boundary');

  const idle = await render('activity-idle', { time: 10 });
  const active = await render('activity-active', { time: 10, progress: .5, activity: 1 });
  const activityDiff = difference(idle, active);
  console.log('activityDiff', JSON.stringify(activityDiff));
  assert.ok(activityDiff.changed > 1000, 'activity enhancement is not visible');

  const nightIdle = await render('night-idle', { time: 10, night: true });
  const nightActive = await render('night-active', { time: 10, progress: .5, activity: 1, night: true });
  const night = difference(nightIdle, nightActive);
  console.log('night', JSON.stringify(night), 'activityDiff', JSON.stringify(activityDiff));
  // The project ambient light illuminates albedo on the night side, so moving
  // patterns can change pixels there. A bright emissive term would exceed this
  // per-channel ceiling even with the direct light behind the globe.
  assert.ok(night.max <= 8, 'weather glows on the night side');

  const lambert = await render('landing-lambert', { time: 0, lambert: true });
  const lambertPixels = [...lambert].filter(value => value > 8).length;
  console.log('lambert', JSON.stringify({ errors, nonblackChannels: lambertPixels }));
  assert.deepEqual(errors, [], 'shader or page error');
  assert.ok(lambertPixels > 1000, 'landing Lambert globe is blank');

  const report = { cloudMotion, determinism, wrap, activityDiff, night, lambertPixels };
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
