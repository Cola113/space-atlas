import {
  BufferGeometry, Float32BufferAttribute, GLSL3, HalfFloatType, LinearFilter,
  Matrix3, Mesh, NoBlending, NoColorSpace, NoToneMapping, OrthographicCamera,
  PerspectiveCamera, RepeatWrapping, Scene, ShaderMaterial, SRGBColorSpace,
  Texture, TextureLoader, UnsignedByteType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import vertex from '../shaders/fullscreen.vert.glsl?raw';
import fragment from '../shaders/blackhole.frag.glsl?raw';
import noise from '../shaders/noise.glsl?raw';
import disk from '../shaders/disk.glsl?raw';
import stars from '../shaders/stars.glsl?raw';
import geodesic from '../shaders/geodesic.glsl?raw';
import bloomFragment from '../shaders/bloom.frag.glsl?raw';
import outputFragment from '../shaders/output.frag.glsl?raw';
import { type Appearance, timePhases } from '../simulation/model';
import { detectCapabilities, PROFILES, type QualityName } from '../quality/Quality';

export interface PickResult { structure: 'sky' | 'shadow' | 'disk' | 'lensed-disk'; radius: number; angle: number }

export class RenderPipeline {
  readonly renderer: WebGLRenderer;
  readonly capabilities;
  readonly shaderErrors: string[] = [];
  private readonly scene = new Scene();
  private readonly screenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new BufferGeometry();
  private readonly mesh: Mesh;
  private readonly hole: ShaderMaterial;
  private readonly bloom: ShaderMaterial;
  private readonly output: ShaderMaterial;
  private readonly sceneTarget: WebGLRenderTarget;
  private readonly bloomA: WebGLRenderTarget;
  private readonly bloomB: WebGLRenderTarget;
  private readonly pickTarget: WebGLRenderTarget;
  private readonly pickBytes = new Uint8Array(4);
  private starTexture: Texture | null = null;
  width = 1;
  height = 1;
  renderWidth = 1;
  renderHeight = 1;
  frames = 0;
  quality: QualityName = 'high';

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!context) throw new Error('此浏览器未提供 WebGL2。请启用硬件加速后使用新版 Edge、Chrome 或 Safari。');
    this.capabilities = detectCapabilities(context);
    this.renderer = new WebGLRenderer({ canvas, context, alpha: false, antialias: false });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const error = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].filter(Boolean).join('\n');
      this.shaderErrors.push(error);
      console.error('Black hole shader compilation:', error);
    };
    const targetOptions = { type: this.capabilities.floatBuffer ? HalfFloatType : UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, stencilBuffer: false };
    this.sceneTarget = new WebGLRenderTarget(1, 1, targetOptions);
    this.bloomA = new WebGLRenderTarget(1, 1, targetOptions);
    this.bloomB = new WebGLRenderTarget(1, 1, targetOptions);
    this.pickTarget = new WebGLRenderTarget(1, 1, { ...targetOptions, type: UnsignedByteType });
    for (const target of [this.sceneTarget, this.bloomA, this.bloomB, this.pickTarget]) target.texture.colorSpace = NoColorSpace;
    this.geometry.setAttribute('position', new Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0], 3));
    this.geometry.setAttribute('uv', new Float32BufferAttribute([0,0, 2,0, 0,2], 2));
    const options = { vertexShader: vertex, glslVersion: GLSL3, depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false };
    this.hole = new ShaderMaterial({ ...options,
      fragmentShader: fragment.replace('/*__NOISE__*/', noise).replace('/*__DISK__*/', disk).replace('/*__STARS__*/', stars).replace('/*__GEODESIC__*/', geodesic),
      uniforms: {
        uEye: { value: new Vector3() }, uCameraBasis: { value: new Matrix3() },
        uAspect: { value: 1 }, uTanHalfFov: { value: Math.tan(Math.PI / 8) },
        uSteps: { value: 320 }, uStepSize: { value: 0.03 }, uPick: { value: 0 }, uPickNdc: { value: new Vector2() },
        uFlow: { value: 0 }, uPulse: { value: 0 }, uDiskIntensity: { value: 1 },
        uStars: { value: null }, uStarIntensity: { value: 1 }, uStarLod: { value: 0 },
      },
    });
    this.bloom = new ShaderMaterial({ ...options, fragmentShader: bloomFragment,
      uniforms: { uSource: { value: null }, uDirection: { value: new Vector2() }, uThreshold: { value: 0.7 } },
    });
    this.output = new ShaderMaterial({ ...options, fragmentShader: outputFragment,
      uniforms: { uScene: { value: this.sceneTarget.texture }, uBloom: { value: this.bloomB.texture }, uTexel: { value: new Vector2() }, uBloomAmount: { value: 0.25 }, uExposure: { value: 1.15 } },
    });
    this.mesh = new Mesh(this.geometry, this.hole);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  async initialize() {
    this.starTexture?.dispose();
    this.starTexture = await new TextureLoader().loadAsync('/shared/starfield.png');
    this.starTexture.colorSpace = SRGBColorSpace;
    this.starTexture.wrapS = RepeatWrapping;
    this.starTexture.anisotropy = 1;
    this.hole.uniforms.uStars.value = this.starTexture;
    for (const material of [this.hole, this.bloom, this.output]) {
      this.mesh.material = material;
      await this.renderer.compileAsync(this.scene, this.screenCamera);
    }
    if (this.shaderErrors.length) throw new Error(this.shaderErrors.join('\n'));
  }

  resize(width: number, height: number, quality = this.quality, pixelRatio = Math.min(devicePixelRatio, PROFILES[quality].pixelCap)) {
    this.width = width;
    this.height = height;
    this.quality = quality;
    const profile = PROFILES[quality];
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.renderWidth = Math.max(1, Math.round(width * pixelRatio * profile.scale));
    this.renderHeight = Math.max(1, Math.round(height * pixelRatio * profile.scale));
    this.sceneTarget.setSize(this.renderWidth, this.renderHeight);
    this.bloomA.setSize(Math.max(1, this.renderWidth >> 2), Math.max(1, this.renderHeight >> 2));
    this.bloomB.setSize(this.bloomA.width, this.bloomA.height);
    this.output.uniforms.uTexel.value.set(1 / this.renderWidth, 1 / this.renderHeight);
    this.hole.uniforms.uSteps.value = profile.steps;
    this.hole.uniforms.uStepSize.value = profile.stepSize;
    this.hole.uniforms.uStarLod.value = Math.log2(4096 / Math.PI * Math.tan(Math.PI / 8) / this.renderHeight);
  }

  private bind(camera: PerspectiveCamera, time: number, appearance: Appearance) {
    const u = this.hole.uniforms;
    u.uEye.value.copy(camera.position);
    u.uCameraBasis.value.setFromMatrix4(camera.matrixWorld);
    u.uAspect.value = camera.aspect;
    u.uTanHalfFov.value = Math.tan(camera.fov * Math.PI / 360);
    const phases = timePhases(time);
    u.uFlow.value = phases.flow;
    u.uPulse.value = phases.pulse;
    u.uDiskIntensity.value = appearance.diskIntensity;
    u.uStarIntensity.value = appearance.stars;
  }

  private pass(material: ShaderMaterial, target: WebGLRenderTarget | null) {
    this.mesh.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.screenCamera);
  }

  render(camera: PerspectiveCamera, time: number, appearance: Appearance, destination: WebGLRenderTarget | null = null) {
    this.bind(camera, time, appearance);
    this.pass(this.hole, this.sceneTarget);
    const bloomEnabled = PROFILES[this.quality].bloom && appearance.bloom > 0;
    if (bloomEnabled) {
      this.bloom.uniforms.uSource.value = this.sceneTarget.texture;
      this.bloom.uniforms.uThreshold.value = 0.75;
      this.bloom.uniforms.uDirection.value.set(2 / this.renderWidth, 0);
      this.pass(this.bloom, this.bloomA);
      this.bloom.uniforms.uSource.value = this.bloomA.texture;
      this.bloom.uniforms.uThreshold.value = -1;
      this.bloom.uniforms.uDirection.value.set(0, 1.5 / this.bloomA.height);
      this.pass(this.bloom, this.bloomB);
    }
    this.output.uniforms.uBloomAmount.value = bloomEnabled ? appearance.bloom : 0;
    this.output.uniforms.uExposure.value = appearance.exposure;
    this.pass(this.output, destination);
    this.renderer.setRenderTarget(null);
    this.frames++;
  }

  pick(ndcX: number, ndcY: number, camera: PerspectiveCamera, time: number, appearance: Appearance, vacuum = false): PickResult {
    this.bind(camera, time, appearance);
    this.hole.uniforms.uPick.value = vacuum ? 2 : 1;
    this.hole.uniforms.uPickNdc.value.set(ndcX, ndcY);
    try {
      this.pass(this.hole, this.pickTarget);
      this.renderer.readRenderTargetPixels(this.pickTarget, 0, 0, 1, 1, this.pickBytes);
    } finally { this.hole.uniforms.uPick.value = 0; this.renderer.setRenderTarget(null); }
    return {
      structure: (['sky', 'shadow', 'disk', 'lensed-disk'] as const)[this.pickBytes[0]] ?? 'sky',
      radius: this.pickBytes[1] / 255 * 12,
      angle: (this.pickBytes[2] / 255 - 0.5) * Math.PI * 2,
    };
  }

  info() {
    return { frames: this.frames, resolution: [this.renderWidth, this.renderHeight], canvas: [this.renderer.domElement.width, this.renderer.domElement.height],
      textures: this.renderer.info.memory.textures, geometries: this.renderer.info.memory.geometries, programs: this.renderer.info.programs?.length,
      shaderErrors: [...this.shaderErrors], capabilities: this.capabilities };
  }

  invalidateLostResources() {
    // Dispose while the context is lost: old GL handles cannot be deleted after restoration.
    // Three.js recreates the reusable targets, geometry and materials on the next render.
    this.starTexture?.dispose(); this.starTexture = null;
    this.geometry.dispose();
    this.hole.dispose(); this.bloom.dispose(); this.output.dispose();
    this.sceneTarget.dispose(); this.bloomA.dispose(); this.bloomB.dispose(); this.pickTarget.dispose();
  }

  dispose() {
    this.geometry.dispose();
    this.hole.dispose(); this.bloom.dispose(); this.output.dispose();
    this.sceneTarget.dispose(); this.bloomA.dispose(); this.bloomB.dispose(); this.pickTarget.dispose();
    this.starTexture?.dispose(); this.renderer.dispose();
  }
}
