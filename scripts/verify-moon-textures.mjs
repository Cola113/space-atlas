import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const base = process.env.ATLAS_URL || 'http://127.0.0.1:5192';
const before = process.argv.includes('--before');
const output = new URL('../test-results/moon-textures/', import.meta.url);
const ids = ['triton', 'iapetus', 'charon', 'rhea', 'mimas', 'callisto'];
const old = ['completed/triton-3840.webp', '4k_iapetus.jpg', 'completed/charon-3840.webp',
  '4k_rhea.jpg', '4k_mimas.jpg', 'completed/callisto-3840.webp'];
await mkdir(output, { recursive: true });
const manifest = before ? null : JSON.parse(await readFile(new URL('../public/solar-system/textures/repaired/provenance.json', import.meta.url)));
const maps = ids.map((id, i) => ({ id, file: before ? old[i] : 'repaired/' + manifest.textures.find(t => t.id === id).high }));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
try {
  // An unlit sphere isolates map defects from the application's changing sunlight.
  const page = await browser.newPage({ viewport: { width: 1500, height: 1500 } });
  await page.goto(base);
  await page.evaluate(async maps => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:0;background:#101114;color:white;font:14px Arial';
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1500, 1500); renderer.setPixelRatio(1);
    renderer.setClearColor('#101114'); renderer.setScissorTest(true);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 20);
    const scene = new THREE.Scene();
    const geometry = new THREE.SphereGeometry(1, 128, 64);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); scene.add(mesh);
    const views = [[0,0], [90,0], [180,0], [270,0], [0,90], [0,-90]];
    for (let row = 0; row < maps.length; row++) {
      const map = await new THREE.TextureLoader().loadAsync('/solar-system/textures/' + maps[row].file);
      map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping;
      map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      mesh.material.map = map; mesh.material.needsUpdate = true;
      for (let col = 0; col < views.length; col++) {
        const [longitude, latitude] = views[col], lon = longitude * Math.PI / 180, lat = latitude * Math.PI / 180;
        camera.position.set(3.8 * Math.cos(lat) * Math.cos(lon), 3.8 * Math.sin(lat), -3.8 * Math.cos(lat) * Math.sin(lon));
        camera.up.set(0, Math.abs(latitude) === 90 ? 0 : 1, Math.abs(latitude) === 90 ? -1 : 0);
        camera.lookAt(0, 0, 0);
        renderer.setViewport(col * 250, (5-row) * 250, 250, 250);
        renderer.setScissor(col * 250, (5-row) * 250, 250, 250);
        renderer.render(scene, camera);
        const label = document.createElement('div');
        label.textContent = maps[row].id + ' / ' + (latitude === 90 ? 'N' : latitude === -90 ? 'S' : longitude);
        label.style.cssText = `position:absolute;left:${col*250+8}px;top:${row*250+5}px;color:#e7e7e7;pointer-events:none`;
        document.body.append(label);
      }
      map.dispose();
    }
    mesh.material.dispose(); geometry.dispose(); renderer.dispose();
  }, maps);
  await page.screenshot({ path: fileURLToPath(new URL(before ? 'before-spheres.png' : 'after-spheres.png', output)) });
  await page.close();
  if (!before) {
    const comparison = [];
    const angles = [1, 1, 4, 2, 2, 1];
    for (let i = 0; i < ids.length; i++) {
      const left = (i % 2) * 500, top = Math.floor(i / 2) * 280;
      const label = `<svg width="500" height="30"><text x="8" y="21" fill="#eee" font-family="Arial" font-size="16">${ids[i].toUpperCase()} / BEFORE</text><text x="258" y="21" fill="#eee" font-family="Arial" font-size="16">AFTER</text></svg>`;
      comparison.push({input:Buffer.from(label),left,top});
      for (const [column, file] of ['before-spheres.png', 'after-spheres.png'].entries()) {
        const input = await sharp(fileURLToPath(new URL(file, output)))
          .extract({left:angles[i]*250,top:i*250,width:250,height:250}).toBuffer();
        comparison.push({input,left:left+column*250,top:top+30});
      }
    }
    await sharp({create:{width:1000,height:840,channels:3,background:'#101114'}})
      .composite(comparison).png().toFile(fileURLToPath(new URL('comparison.png',output)));
  }
  if (!before && !process.argv.includes('--spheres-only')) for (const [name, width, height] of [['desktop',1440,900], ['phone',390,844], ['short',800,450]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', hasTouch: name === 'phone' });
    await context.addInitScript(() => sessionStorage.setItem('space-atlas:scene:solar-system', JSON.stringify({version:1,value:{playing:false,followRotation:false}})));
    const page = await context.newPage(), errors = [], loaded = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if(response.ok()) loaded.add(new URL(response.url()).pathname); });
    await page.goto(base + '/solar-system/');
    const settle = () => page.waitForFunction(() => window.solarAtlas?.snapshot().ready && !window.solarAtlas.snapshot().flight && document.querySelector('#loading-screen').hidden, null, {timeout:90000});
    await settle();
    for (const id of ids) {
      await page.locator('#atlas-tab').click();
      await page.locator('#atlas-system').selectOption('all');
      await page.locator('#atlas-search').fill(id);
      await page.locator(`.atlas-item[data-body="${id}"]`).click();
      await settle();
      const record = manifest.textures.find(t => t.id === id);
      await page.waitForFunction(({id,width}) => window.solarAtlas.snapshot().bodies.find(b => b.id === id).textureWidth === width, {id,width:record.deliveredDimensions[0]}, {timeout:90000});
      assert.ok(loaded.has('/solar-system/textures/repaired/' + record.high), id + ': high texture not fetched');
      const state = await page.evaluate(() => window.solarAtlas.snapshot());
      const body = state.bodies.find(b => b.id === id);
      const canvas = page.locator('#universe canvas');
      const image = await canvas.screenshot();
      const x = Math.max(0, Math.floor(body.x-body.radiusPx)), y = Math.max(0, Math.floor(body.y-body.radiusPx));
      const w = Math.max(1, Math.min(width-x, Math.ceil(body.radiusPx*2))), h = Math.max(1, Math.min(height-y, Math.ceil(body.radiusPx*2)));
      const pixels = await sharp(image).extract({left:x,top:y,width:w,height:h}).resize(64,64).removeAlpha().raw().toBuffer();
      const visible = [...pixels].filter(v => v > 30).length;
      assert.ok(visible > 100, `${name}/${id}: blank body pixels`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({path:fileURLToPath(new URL(`${name}-${id}.png`,output))});
      // Verify actual orbit interaction changes the view while the paused body stays fixed.
      const start = await page.evaluate(() => {
        for (let y = 120; y < innerHeight-100; y += 30) for(let x = 40; x < innerWidth-100; x += 40)
          if(document.elementFromPoint(x,y)?.matches('#universe canvas')) return {x,y};
        throw new Error('No exposed canvas for orbit gesture');
      });
      await page.mouse.move(start.x,start.y); await page.mouse.down();
      await page.mouse.move(start.x+60,start.y+20,{steps:8}); await page.mouse.up();
      await page.waitForTimeout(500);
      const moved = await page.evaluate(() => window.solarAtlas.snapshot());
      assert.notDeepEqual(moved.camera,state.camera);
      assert.equal(moved.date,state.date);
      report.push({viewport:name,id,textureWidth:body.textureWidth,visiblePixelChannels:visible,dragChangesCamera:true,pausedDateStable:true});
    }
    assert.deepEqual(errors, []);
    console.log(`${name}: all six repaired maps load, render and orbit`);
    await context.close();
  }
  if (report.length) await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));
} finally { await browser.close(); }
