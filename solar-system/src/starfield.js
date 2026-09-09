import * as THREE from 'three';
import { brightStars } from './sky-data/bright-stars.js';
import { skyRotation, equatorialDirection, equatorialToGalactic, starAppearance, skyExposure } from './sky-coordinates.js';

const vertex = `
  uniform mat3 uSkyRotation;
  uniform float uPixelRatio;
  attribute vec3 starColour;
  attribute float starSize;
  varying vec3 vColour;
  void main() {
    vec3 direction = mat3(viewMatrix) * uSkyRotation * position;
    gl_Position = projectionMatrix * vec4(direction, 1.0);
    // Render at infinity. Translation and zoom cannot make star discs expand.
    gl_Position.z = gl_Position.w * 0.999999;
    gl_PointSize = starSize * uPixelRatio;
    vColour = starColour;
  }
`;
const fragment = `
  uniform float uExposure;
  varying vec3 vColour;
  void main() {
    float radius = length(gl_PointCoord * 2.0 - 1.0);
    float alpha = 1.0 - smoothstep(0.15, 1.0, radius);
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(vColour * uExposure, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createStarfield(renderer) {
  const group = new THREE.Group();
  group.name = 'HYG stars and Gaia sky';
  let disposed = false, count = brightStars.length, fullCatalogue = false, galaxyReady = false;
  let catalogueFailed = false, galaxyFailed = false, day = null, exposure = 1, occupancy = 0;
  const abort = new AbortController();
  const rotation = skyRotation(new Date());
  const direction = new THREE.Vector3();
  function geometryFor(rows) {
    const positions = [], colours = [], sizes = [];
    for (const [, ra, dec, magnitude, bv] of rows) {
      equatorialDirection(ra, dec, direction);
      positions.push(direction.x, direction.y, direction.z);
      const appearance = starAppearance(magnitude, bv);
      colours.push(...appearance.colour.map(value => value * appearance.brightness));
      sizes.push(appearance.size);
    }
    return new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      .setAttribute('starColour', new THREE.Float32BufferAttribute(colours, 3))
      .setAttribute('starSize', new THREE.Float32BufferAttribute(sizes, 1));
  }
  const points = new THREE.Points(geometryFor(brightStars), new THREE.ShaderMaterial({
    uniforms: { uSkyRotation: { value: rotation }, uPixelRatio: { value: renderer.getPixelRatio() }, uExposure: { value: 1 } },
    vertexShader: vertex, fragmentShader: fragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
  }));
  points.name = 'Catalogue stars';
  points.frustumCulled = false;
  points.renderOrder = -999;
  group.add(points);

  const empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  empty.needsUpdate = true;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: empty }, uExposure: { value: 1 }, uReady: { value: 0 },
      uSkyRotation: { value: rotation }, uGalactic: { value: equatorialToGalactic },
      uBackground: { value: new THREE.Color('#07090b') },
    },
    vertexShader: `
      uniform mat3 uSkyRotation;
      varying vec3 vEquatorial;
      void main() {
        vEquatorial = position;
        vec3 direction = mat3(viewMatrix) * uSkyRotation * position;
        gl_Position = projectionMatrix * vec4(direction, 1.0);
        gl_Position.z = gl_Position.w * 0.999999;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform mat3 uGalactic;
      uniform vec3 uBackground;
      uniform float uExposure;
      uniform float uReady;
      varying vec3 vEquatorial;
      void main() {
        vec3 d = normalize(uGalactic * normalize(vEquatorial));
        vec2 uv = vec2(0.5 - atan(d.y, d.x) / 6.28318530718, 0.5 + asin(clamp(d.z, -1.0, 1.0)) / 3.14159265359);
        vec3 sampleColour = texture2D(uMap, uv).rgb;
        // Gaia's colour map is a processed observation; this is a muted display,
        // not a physical radiance or human-eye exposure reconstruction.
        vec3 diffuse = pow(sampleColour, vec3(1.25)) * 0.013 * uExposure * uReady;
        gl_FragColor = vec4(uBackground + diffuse, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  }));
  dome.name = 'Gaia diffuse Milky Way';
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  group.add(dome);

  const catalogueReady = fetch('/solar-system/sky/hyg-v41-mag65.json', { signal: abort.signal })
    .then(response => { if (!response.ok) throw new Error('Star catalogue unavailable'); return response.json(); })
    .then(data => {
      if (disposed) return;
      if (data.version !== 1 || data.epoch !== 'J2000.0' || !Array.isArray(data.stars) || data.stars.length < 8000 || data.stars.length > 12000 ||
        data.stars.some(row => !Array.isArray(row) || row.length !== 5 || !row.slice(0, 4).every(Number.isFinite) || (row[4] !== null && !Number.isFinite(row[4])))) {
        throw new Error('Invalid star catalogue');
      }
      const geometry = geometryFor(data.stars);
      points.geometry.dispose(); points.geometry = geometry;
      count = data.stars.length; fullCatalogue = true;
    }).catch(() => { if (!disposed) catalogueFailed = true; });
  const galaxyPromise = new THREE.TextureLoader().loadAsync('/solar-system/sky/gaia-edr3-diffuse.webp')
    .then(texture => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      dome.material.uniforms.uMap.value.dispose();
      dome.material.uniforms.uMap.value = texture;
      galaxyReady = true;
    }).catch(() => { if (!disposed) galaxyFailed = true; });
  return {
    group,
    ready: Promise.all([catalogueReady, galaxyPromise]),
    update({ camera, date, dt, brightOccupancy = 0 }) {
      group.position.copy(camera.position);
      const nextDay = Math.floor(date / 86400000);
      if (nextDay !== day) { rotation.copy(skyRotation(new Date(date))); day = nextDay; }
      occupancy = brightOccupancy;
      const target = skyExposure(occupancy);
      exposure = THREE.MathUtils.damp(exposure, target, target < exposure ? 1.4 : 0.5, dt);
      points.material.uniforms.uExposure.value = exposure;
      points.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      dome.material.uniforms.uExposure.value = exposure;
      dome.material.uniforms.uReady.value = THREE.MathUtils.damp(dome.material.uniforms.uReady.value, galaxyReady ? 1 : 0, 0.65, dt);
    },
    snapshot: () => ({ mode: fullCatalogue ? 'catalogue' : 'bright-stars', count, catalogue: 'HYG v4.1', magnitudeLimit: 6.5,
      galaxyReady, catalogueFailed, galaxyFailed, exposure, brightOccupancy: occupancy, maxStarSizeCss: 1.85,
      epoch: 'J2000.0', frame: 'true ecliptic of simulation date', rotation: rotation.toArray() }),
    dispose() {
      disposed = true; abort.abort(); group.removeFromParent();
      points.geometry.dispose(); points.material.dispose();
      dome.geometry.dispose(); dome.material.uniforms.uMap.value.dispose(); dome.material.dispose();
    },
  };
}
