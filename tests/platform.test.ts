import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenes } from '../platform/scenes.js';
import { readSession, writeSession } from '../platform/session.ts';
import { createAtlasServer } from '../server/app.js';

test('scene sessions are independent, versioned and tolerate restricted storage', () => {
  const values = new Map<string, string>();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    writeSession('solar-system', { selected: 'saturn' });
    writeSession('black-hole', { paused: true });
    assert.deepEqual(readSession('solar-system'), { selected: 'saturn' });
    assert.deepEqual(readSession('black-hole'), { paused: true });
    values.set('space-atlas:scene:solar-system', '{invalid');
    assert.equal(readSession('solar-system'), null);
    values.set('space-atlas:scene:solar-system', '{"version":99,"value":{}}');
    assert.equal(readSession('solar-system'), null);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    assert.equal(readSession('black-hole'), null);
    assert.doesNotThrow(() => writeSession('black-hole', {}));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('production server serves both routes, assets and cloud API without SPA fallbacks', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'space-atlas-server-'));
  const publicDirectory = join(temporary, 'dist');
  for (const scene of scenes) {
    const directory = join(publicDirectory, scene.id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), `<title>${scene.id}</title>`);
  }
  await mkdir(join(publicDirectory, 'shared'));
  await writeFile(join(publicDirectory, 'shared', 'test.txt'), 'shared asset');
  const { server, clouds } = createAtlasServer({ publicDirectory, cloudDirectory: join(temporary, 'cache'),
    fetcher: async () => { throw new Error('upstream offline'); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  try {
    const root = await fetch(base, { redirect: 'manual' });
    assert.equal(root.headers.get('location'), '/solar-system/');
    for (const scene of scenes) {
      assert.match(await (await fetch(base + scene.path)).text(), new RegExp(scene.id));
      const response = await fetch(base + scene.path.slice(0, -1) + '?demo=1', { redirect: 'manual' });
      assert.equal(response.headers.get('location'), scene.path + '?demo=1');
    }
    assert.equal(await (await fetch(base + '/shared/test.txt')).text(), 'shared asset');
    assert.equal((await fetch(base + '/missing.js')).status, 404);
    assert.equal((await fetch(base + '/api/missing')).status, 404);
    const status = await (await fetch(base + '/api/clouds')).json();
    assert.equal(status.frame, null);
    await clouds.refresh();
    assert.equal(clouds.snapshot().error, 'upstream offline');
    assert.equal((await fetch(base + '/api/clouds/images/invalid.png')).status, 404);
    assert.equal((await fetch(base + '/shared/test.txt', { method: 'POST' })).status, 404);
  } finally {
    clouds.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
});
