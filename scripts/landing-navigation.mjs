import { MathUtils, Quaternion, Spherical, Vector3 } from 'three';

// A body can carry several sites, so the snapshot lists them all; these helpers
// pick the one the caller asked for.
export function landingEntry(state, id) {
  const entry = (state.landmarks.landing || []).find(entry => entry.siteId === id);
  if (!entry) throw new Error(`${id}: no landing marker for this site`);
  return entry;
}

// Use the public orbit gesture to turn a fixed landing site toward/away from the camera.
// `id` is a site id, which for every body keeps matching the body's first site.
export async function aimAtLanding(page, id, { back = false } = {}) {
  const initial = await page.evaluate(() => window.solarAtlas.snapshot());
  if (initial.playing) await page.locator('#play-toggle').click();
  const site = landingEntry(initial, id), lat = MathUtils.degToRad(site.latitude), lon = MathUtils.degToRad(site.longitude);
  // Small drags: a long gesture can end over a neighbouring body on screen, and
  // releasing there selects that body instead of leaving the camera where we want it.
  const chunk = 48;
  for (let step = 0; step < 60; step++) {
    const state = await page.evaluate(() => window.solarAtlas.snapshot());
    const body = state.bodies.find(body => body.id === site.body);
    const direction = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
      .applyQuaternion(new Quaternion().fromArray(body.orientation)).multiplyScalar(back ? -1 : 1);
    const offset = new Vector3().fromArray(state.camera).sub(new Vector3().fromArray(state.target)).normalize();
    // Facing away (`back`) needs the true antipode. Facing the site only needs the pin
    // to show: rotating on to exact alignment can hand the space to a neighbouring pin
    // or hide it behind the body, and the caller then has nothing to click.
    const aligned = offset.dot(direction) > .997;
    const shows = landingEntry(state, id).visible;
    if ((back && aligned) || (!back && (aligned || shows))) {
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
    const dx = MathUtils.clamp(-theta * height / (2 * Math.PI * .55), -chunk, chunk);
    const dy = MathUtils.clamp(-(target.phi - current.phi) * height / (2 * Math.PI * .55), -chunk, chunk);
    // A gesture shorter than the app's tap threshold is read as a click on whatever
    // is under the pointer, which can select a neighbouring body instead.
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    // The body keeps moving while the camera settles and the panels resize, and it can
    // sit partly outside the canvas, so scan the viewport for the free canvas point
    // closest to it that still fits the whole drag, instead of trusting five offsets.
    let start = null;
    for (let attempt = 0; attempt < 6 && !start; attempt++) {
      const live = await page.evaluate(bodyId => {
        const body = window.solarAtlas.snapshot().bodies.find(body => body.id === bodyId);
        return body ? { x: body.x, y: body.y } : null;
      }, site.body);
      if (!live) break;
      start = await page.evaluate(({ x, y, dx, dy }) => {
        const fits = (px, py) => Math.min(px, px + dx) >= 8 && Math.max(px, px + dx) <= innerWidth - 8 &&
          Math.min(py, py + dy) >= 8 && Math.max(py, py + dy) <= innerHeight - 8;
        let best = null;
        for (let px = 12; px <= innerWidth - 12; px += 24) for (let py = 12; py <= innerHeight - 12; py += 24) {
          if (!fits(px, py) || !document.elementFromPoint(px, py)?.matches('#universe canvas')) continue;
          const distance = Math.hypot(px - x, py - y);
          if (!best || distance < best.distance) best = { x: px, y: py, distance };
        }
        return best || { failed: `body ${x},${y} d ${dx},${dy} view ${innerWidth}x${innerHeight}` };
      }, { x: live.x, y: live.y, dx, dy });
      if (start?.failed) { start = null; await page.waitForTimeout(250); }
    }
    if (!start) throw new Error(`${id}: no canvas area for the landing-site orbit gesture after retries`);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
  }
  throw new Error(`${id}: could not orbit to the ${back ? 'back' : 'visible'} landing hemisphere`);
}

export async function revealLanding(page, id) {
  if (!await page.locator(`[data-landing-site="${id}"]`).isVisible()) await aimAtLanding(page, id);
}

export async function landingFocusRestored(page, id) {
  return page.evaluate(id => {
    const marker = document.querySelector(`[data-landing-site="${id}"]`);
    const info = document.getElementById('body-details-button');
    return document.activeElement === (marker?.checkVisibility() ? marker : info.checkVisibility() ? info : document.getElementById('landmark-brief-close'));
  }, id);
}
