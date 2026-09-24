import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launchBrowser } from './browser-launch.mjs';

// Isolate shader motion from rotation/camera movement. Also compile the shared
// Lambert path used by the observation sky, verify vortex staging, night side and seam.
const base = process.env.ATLAS_URL || 'http://127.0.0.1:5191';
const output = new URL('../test-results/neptune-weather/render/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
const report = [];

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.route('**/__neptune-weather-probe', route => route.fulfill({
    contentType: 'text/html',
    body: '<style>body{margin:0;background:black}</style>',
  }));
  await page.goto(base + '/__neptune-weather-probe');

  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { patchNeptuneWeather, createNeptuneWeatherUniforms, neptuneVortexUv } = await import('/solar-system/src/neptune-weather.js');
    const { bodyModels } = await import('/solar-system/src/body-models.js');
    const { createBodyGeometry } = await import('/solar-system/src/body-geometry.js');
    const { bindPhysicalSun } = await import('/solar-system/src/physical-lighting.js');
    const { bindSkyDepth } = await import('/solar-system/src/surface/sky-depth.js');

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(800, 800);
    renderer.setPixelRatio(1);
    document.body.append(renderer.domElement);

    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10);
    const map = await new THREE.TextureLoader().loadAsync('/solar-system/textures/2k_neptune.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.anisotropy = 4;

    const uniforms = createNeptuneWeatherUniforms();
    const sun = new THREE.Vector3(), light = new THREE.DirectionalLight('white', 2.2);
    scene.add(light, new THREE.AmbientLight('white', 0.018));

    const materials = [
      new THREE.MeshStandardMaterial({ map, roughness: 1 }),
      new THREE.MeshLambertMaterial({ map }),
    ];
    for (const material of materials) {
      patchNeptuneWeather(material, uniforms);
      bindPhysicalSun(material, sun);
    }
    bindSkyDepth(materials[1], { value: 100000 }, { value: new THREE.Vector2(100, 20) });

    const mesh = new THREE.Mesh(createBodyGeometry(bodyModels.neptune, new THREE.SphereGeometry(1, 128, 96)), materials[0]);
    scene.add(mesh);

    // Aim the camera at a point on the globe given in texture uv (vMapUv convention).
    function aimDirection(u, v) {
      const longitude = u * Math.PI * 2, latitude = (v - .5) * Math.PI;
      return new THREE.Vector3(
        -Math.cos(longitude) * Math.cos(latitude),
        Math.sin(latitude),
        Math.sin(longitude) * Math.cos(latitude),
      ).normalize();
    }

    const spot = neptuneVortexUv(0);
    window.neptuneProbe = {
      render({ time = 0, progress = -1, spotUv = spot, activity = 0, detail = 1, night = false, lambert = false, aim = [.563, .409] } = {}) {
        uniforms.uNeptuneTime.value = time;
        uniforms.uNeptuneProgress.value = progress;
        uniforms.uNeptuneSpot.value.set(spotUv[0], spotUv[1]);
        uniforms.uNeptuneActivity.value = activity;
        uniforms.uNeptuneDetail.value = detail;

        const dir = aimDirection(aim[0], aim[1]);
        camera.position.copy(dir).multiplyScalar(4);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);

        sun.copy(dir).multiplyScalar(night ? -1 : 1);
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

  function coreMean(buffer) {
    // Mean luminance of the central 32x32 patch: small enough that the flank companion
    // bands (offset |Δv| ≥ .022 UV) stay outside, so only the dark core lands here.
    let sum = 0, n = 0;
    for (let y = 384; y < 416; y++) {
      for (let x = 384; x < 416; x++) {
        const i = (y * 800 + x) * 3;
        sum += .2126 * buffer[i] + .7152 * buffer[i + 1] + .0722 * buffer[i + 2];
        n++;
      }
    }
    return sum / n;
  }

  // 1. Ambient flow motion (jet advection, churn, cirrus, Scooter)
  const start = await render('flow-0', { time: 0 });
  const moved = await render('flow-8', { time: 8 });
  const cloudMotion = difference(start, moved);
  console.log('cloudMotion', JSON.stringify(cloudMotion));
  assert.ok(cloudMotion.changed > 1000, 'atmosphere does not move independently of the planet');

  // 2. Fixed weather determinism check
  assert.ok((await render('flow-0-repeated', { time: 0 })).equals(start), 'fixed weather state is not deterministic');

  // 3. Mid-high latitude tracer motion: aim at 50°S where the prograde jets blow
  const midLat = [0.563, 0.5 + 50 / 180];
  const lat0 = await render('midlat-0', { time: 0, aim: midLat });
  const lat8 = await render('midlat-8', { time: 8, aim: midLat });
  const polarMotion = difference(lat0, lat8);
  console.log('midLatMotion', JSON.stringify(polarMotion));
  assert.ok(polarMotion.changed > 500, 'high-latitude cirrus tracers do not move');

  // 4. Bounded cyclic advection boundary wrap smoothness (26s cycle)
  const left = await render('cycle-before', { time: 25.99 });
  const right = await render('cycle-after', { time: 26.01 });
  const wrap = difference(left, right);
  console.log('cycleWrap', JSON.stringify(wrap), 'vs motion', JSON.stringify(cloudMotion));
  assert.ok(wrap.mean < cloudMotion.mean * 0.08, 'bounded advection jumps at its cycle boundary');

  // 5. Companion clouds lead the dark core: early progress brightens the flanks
  const idle = await render('event-idle', { time: 10, aim: [.21, .315] });
  const early = await render('event-early', { time: 10, progress: .08, activity: .31, spotUv: [.21, .315], aim: [.21, .315] });
  const earlyDiff = difference(idle, early);
  console.log('earlyCompanions', JSON.stringify(earlyDiff));
  assert.ok(earlyDiff.changed > 300, 'companion clouds do not lead the vortex');
  assert.ok(coreMean(early) > coreMean(idle) * .985, 'the dark core appears before its companion clouds');

  // 6. Event peak: the dark core darkens the aimed region and reshapes the disc
  const peak = await render('event-peak', { time: 11, progress: .5, activity: .99, spotUv: [.21, .315], aim: [.21, .315] });
  const peakDiff = difference(idle, peak);
  console.log('peakDiff', JSON.stringify(peakDiff), 'center', coreMean(idle).toFixed(1), '->', coreMean(peak).toFixed(1));
  assert.ok(peakDiff.changed > 1000, 'storm event does not change the disc');
  assert.ok(coreMean(peak) < coreMean(idle) * .97, 'the dark core does not darken its center');

  // 7. Core dissipates: late progress leaves only faint companions
  const late = await render('event-late', { time: 12, progress: .95, activity: .16, spotUv: [.21, .315], aim: [.21, .315] });
  const lateDiff = difference(peak, late);
  console.log('lateDiff', JSON.stringify(lateDiff));
  assert.ok(coreMean(late) > coreMean(peak), 'the dark core does not dissipate');

  // 8. Night side non-emission (must not glow on unlit hemisphere)
  const night0 = await render('night-baseline', { time: 10, night: true });
  const nightActive = await render('night-active', { time: 10, night: true, activity: 1, progress: .5 });
  const night = difference(night0, nightActive);
  console.log('nightDiff', JSON.stringify(night), 'limit', peakDiff.mean * 0.15);
  assert.ok(night.max <= 8 && night.changed < peakDiff.changed * .05, 'weather or haze glows on the unlit hemisphere');

  // 9. Observation-sky shared Lambert material compilation
  await render('observation-shared-material', { time: 0, lambert: true, aim: midLat });

  assert.deepEqual(errors, []);
  report.push({ cloudMotion, polarMotion, wrap, earlyDiff, peakDiff, lateDiff, night });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
