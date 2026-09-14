import { MathUtils, Quaternion, Spherical, Vector3 } from 'three';

// Use the public orbit gesture to turn a fixed landing site toward/away from the camera.
export async function aimAtLanding(page, id, { back = false } = {}) {
  const initial = await page.evaluate(() => window.solarAtlas.snapshot());
  if (initial.playing) await page.locator('#play-toggle').click();
  const site = initial.landmarks.landing, lat = MathUtils.degToRad(site.latitude), lon = MathUtils.degToRad(site.longitude);
  for (let step = 0; step < 18; step++) {
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    const body = state.bodies.find(body => body.id === id);
    const direction = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
      .applyQuaternion(new Quaternion().fromArray(body.orientation)).multiplyScalar(back ? -1 : 1);
    const offset = new Vector3().fromArray(state.camera).sub(new Vector3().fromArray(state.target)).normalize();
    if (offset.dot(direction) > .997 && (back || state.landmarks.landing?.visible)) {
      // Let the public drag finish before recording a departure camera pose.
      await page.evaluate(() => new Promise((resolve, reject) => {
        let previous = window.solarAtlas.snapshot().camera, stable = 0, attempts = 0;
        const poll = () => {
          const camera = window.solarAtlas.snapshot().camera;
          stable = camera.every((value, index) => Math.abs(value - previous[index]) < 1e-10) ? stable + 1 : 0;
          previous = camera;
          if (stable >= 3) resolve();
          else if (++attempts > 100) reject(new Error('Orbit gesture did not settle'));
          else setTimeout(poll, 100);
        };
        poll();
      }));
      if (initial.playing) await page.locator('#play-toggle').click();
      return;
    }
    const current = new Spherical().setFromVector3(offset), target = new Spherical().setFromVector3(direction);
    const { height } = page.viewportSize();
    const theta = MathUtils.euclideanModulo(target.theta - current.theta + Math.PI, 2 * Math.PI) - Math.PI;
    const dx = MathUtils.clamp(-theta * height / (2 * Math.PI * .55), -160, 160);
    const dy = MathUtils.clamp(-(target.phi - current.phi) * height / (2 * Math.PI * .55), -110, 110);
    const start = await page.evaluate(({ x, y, dx, dy }) => {
      for (const sy of [0, -40, 40, -80, 80]) for (const sx of [0, -60, 60, -120, 120]) {
        const px = x + sx, py = y + sy;
        if (Math.min(px, px + dx) < 8 || Math.max(px, px + dx) > innerWidth - 8 || Math.min(py, py + dy) < 8 || Math.max(py, py + dy) > innerHeight - 8) continue;
        if (document.elementFromPoint(px, py)?.matches('#universe canvas')) return { x: px, y: py };
      }
      throw new Error('No canvas area for landing-site orbit gesture');
    }, { x: body.x, y: body.y, dx, dy });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
  }
  throw new Error(`${id}: could not orbit to the ${back ? 'back' : 'visible'} landing hemisphere`);
}

export async function revealLanding(page, id) {
  if (!await page.locator(`[data-landing-body="${id}"]`).isVisible()) await aimAtLanding(page, id);
}

export async function landingFocusRestored(page, id) {
  return page.evaluate(id => {
    const marker = document.querySelector(`[data-landing-body="${id}"]`);
    const info = document.getElementById('body-details-button');
    return document.activeElement === (marker?.checkVisibility() ? marker : info.checkVisibility() ? info : document.getElementById('landmark-brief-close'));
  }, id);
}
