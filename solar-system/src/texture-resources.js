import * as THREE from 'three';
import { ResourceQueue } from './resource-queue.js';

export const textureRoot = '/solar-system/textures/';
export const firstScreenTextures = [
  ['sun', '2k_sun.jpg'], ['mercury', '2k_mercury.jpg'],
  ['venus', '2k_venus_atmosphere.jpg'], ['earth', '2k_earth_daymap.jpg'],
  ['mars', '2k_mars.jpg'], ['jupiter', '2k_jupiter.jpg'],
  ['saturn', '2k_saturn.jpg'], ['uranus', '2k_uranus.jpg'], ['neptune', '2k_neptune.jpg'],
  ['earth-clouds', '2k_earth_clouds.jpg'], ['saturn-ring', '2k_saturn_ring_alpha.png'],
].map(([id, key]) => ({ id, key, file: `previews/${id}.webp` }));
export const firstScreenIds = new Set(firstScreenTextures.slice(0, 9).map(item => item.id));

export function createTextureResources(configure) {
  const queue = new ResourceQueue(4);
  const textures = new Set();
  const urls = new Set();
  let disposed = false;
  async function blob(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Resource HTTP ${response.status}`);
    return response.blob();
  }
  function texture(url, { priority = 0, timeout = 15000, longitude = true, preempt = false } = {}) {
    return queue.run(url, async signal => {
      const imageUrl = URL.createObjectURL(await blob(url, signal));
      const image = new Image();
      const abort = () => { image.src = ''; };
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        image.src = imageUrl;
        await image.decode();
        signal.throwIfAborted();
        if (disposed) throw new Error('Textures disposed');
        const value = configure(new THREE.Texture(image), true, longitude);
        textures.add(value);
        return value;
      } finally {
        signal.removeEventListener('abort', abort);
        URL.revokeObjectURL(imageUrl);
      }
    }, { priority, timeout, preempt });
  }
  return {
    queue, texture,
    thumbnail(id) {
      const url = `${textureRoot}thumbnails/${id}.webp`;
      return queue.run(url, async signal => {
        const value = await blob(url, signal);
        signal.throwIfAborted();
        const imageUrl = URL.createObjectURL(value);
        urls.add(imageUrl);
        return imageUrl;
      }, { priority: 5, timeout: 8000 });
    },
    release(url, value) { queue.forget(url); textures.delete(value); value?.dispose(); },
    dispose() {
      disposed = true; queue.dispose();
      for (const value of textures) value.dispose();
      for (const url of urls) URL.revokeObjectURL(url);
      textures.clear(); urls.clear();
    },
  };
}
