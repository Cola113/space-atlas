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
    // Neutral albedo isolates procedural shape and seam continuity from map features.
    const neutral = new THREE.DataTexture(new Uint8Array([52, 101, 174, 255]), 1, 1);
    neutral.colorSpace = THREE.SRGBColorSpace;
    neutral.needsUpdate = true;

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
      render({ time = 0, progress = -1, spotUv = spot, activity = 0, detail = 1, seed = 0, flat = false, night = false, lambert = false, aim = [.563, .409] } = {}) {
        uniforms.uNeptuneTime.value = time;
        uniforms.uNeptuneProgress.value = progress;
        uniforms.uNeptuneSpot.value.set(spotUv[0], spotUv[1]);
        uniforms.uNeptuneActivity.value = activity;
        uniforms.uNeptuneDetail.value = detail;
        uniforms.uNeptuneSeed.value = seed;

        const dir = aimDirection(aim[0], aim[1]);
        camera.position.copy(dir).multiplyScalar(4);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);

        sun.copy(dir).multiplyScalar(night ? -1 : 1);
        light.position.copy(sun);
        mesh.material = materials[lambert ? 1 : 0];
        mesh.material.map = flat ? neutral : map;
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

  function difference(a, b, inset = 100) {
    let changed = 0, total = 0, sum = 0, largest = 0;
    for (let y = inset; y < 800 - inset; y++) {
      for (let x = inset; x < 800 - inset; x++) {
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

  // 3. Mid-high latitude tracer motion: aim at 50°N where the prograde jets blow
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

  // 10. The baked GDS must still occupy its catalogue landmark after long runs.
  // Compare its centre with clear sky at the same latitude and identical illumination.
  const anchoring = [];
  for (const time of [0, 26, 300, 3600]) {
    const gds = await render(`anchor-${time}`, { time });
    const clear = await render(`clear-${time}`, { time, aim: [.80, .409] });
    const ratio = coreMean(gds) / coreMean(clear);
    anchoring.push({ time, ratio });
    assert.ok(ratio < .94, `GDS has drifted off its landmark at ${time}s: ${ratio}`);
  }

  // 11. Isolate an event on uniform albedo. Distinct births must not be copies,
  // while returning to a given birth and age must exactly reproduce the same frame.
  const isolated = { time: 11, progress: .5, activity: 0, detail: 0, flat: true,
    spotUv: [.21, .315], aim: [.21, .315] };
  const shape0 = await render('shape-seed-0', isolated);
  const shape1 = await render('shape-seed-1', { ...isolated, seed: 1 });
  const variation = difference(shape0, shape1);
  assert.ok(variation.changed > 1500, 'successive vortices repeat the same silhouette/clouds');
  assert.ok((await render('shape-repeat', isolated)).equals(shape0), 'vortex shape depends on render history');
  // Temporal continuity during formation, erosion and the end of the event.
  const continuity = [];
  for (const progress of [.14, .36, .58, .78, .94, 1]) {
    const before = await render(`stage-${progress}-before`, { ...isolated, progress: progress - .0005 });
    const after = await render(`stage-${progress}-after`, { ...isolated, progress: progress + .0005 });
    const delta = difference(before, after);
    continuity.push({ progress, ...delta });
    assert.ok(delta.mean < .15 && delta.max < 12, `vortex jumps at phase ${progress}`);
  }
  // Match relative view/spot geometry across the longitude seam. A constant map and
  // disabled global details mean longitude alone cannot change the visible storm.
  const seam = await render('event-seam', { ...isolated, spotUv: [.999, .315], aim: [.999, .315] });
  // Exclude the faceted sphere silhouette: camera longitude changes edge coverage
  // there by a few pixels independently of the shader. The full storm is in this ROI.
  const seamDifference = difference(shape0, seam, 220);
  assert.ok(seamDifference.mean < .1 && seamDifference.max < 8, 'vortex tears at the longitude seam');
  await render('event-northern', { ...isolated, seed: 1, spotUv: [.76, .685], aim: [.76, .685], detail: 1, flat: false });

  // Save a temporal contact sheet for visual review, not just pixel-change assertions.
  const frames = [];
  for (const [row, type] of ['gds', 'vortex'].entries()) {
    for (const [column, time] of [0, 4, 8, 12, 16, 20].entries()) {
      const options = type === 'gds' ? { time } : {
        time, progress: time / 22, spotUv: [.21, .315], aim: [.21, .315], activity: 0,
      };
      await render(`sequence-${type}-${time}`, options);
      const input = await sharp(fileURLToPath(new URL(`sequence-${type}-${time}.png`, output))).resize(320, 320).toBuffer();
      frames.push({ input, left: column * 320, top: row * 320 });
    }
  }
  await sharp({ create: { width: 1920, height: 640, channels: 3, background: '#000' } })
    .composite(frames).png().toFile(fileURLToPath(new URL('sequence.png', output)));

  assert.deepEqual(errors, []);
  report.push({ cloudMotion, polarMotion, wrap, earlyDiff, peakDiff, lateDiff, night, anchoring, variation, continuity, seamDifference });
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
