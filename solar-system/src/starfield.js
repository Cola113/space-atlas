import * as THREE from "three";

// The same synthetic sky used by the black-hole observatory (seed 1787).
// A camera-centred sphere keeps the sky at infinity without lens distortion.
export function createStarfield(fallback, renderer) {
  const sky = new THREE.Group();
  sky.name = "Distant starfield";
  sky.add(fallback);
  sky.userData.mode = "fallback";
  sky.userData.textureWidth = 0;

  new THREE.TextureLoader().load("/shared/starfield.png", (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1100, 96, 64),
      new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color().setRGB(0.9, 0.9, 0.9),
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    // Render behind all bodies, even when flying beyond the sky sphere's radius.
    dome.renderOrder = -1000;
    dome.frustumCulled = false;
    sky.add(dome);
    sky.remove(fallback);
    fallback.geometry.dispose();
    fallback.material.dispose();
    sky.userData.mode = "textured";
    sky.userData.textureWidth = texture.image.width;
  }, undefined, () => {
    // Keep the lightweight point stars if the local texture cannot be loaded.
    sky.userData.mode = "fallback";
  });

  return sky;
}
