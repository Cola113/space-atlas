import { PerspectiveCamera, Spherical, UnsignedByteType, Vector3, WebGLRenderTarget } from 'three';
import { presetPose, type CameraPose, type ViewName } from '../camera/CameraRig';
import { RenderPipeline } from '../rendering/Pipeline';
import type { Appearance } from '../simulation/model';
import { PROFILES, type QualityName } from '../quality/Quality';

export interface CaptureOptions {
  time: number;
  width?: number;
  height?: number;
  preset?: ViewName;
  camera?: CameraPose;
  quality?: QualityName;
}

export class CaptureController {
  constructor(private readonly pipeline: RenderPipeline, private readonly appearance: Appearance, private readonly restore: () => void) {}

  renderAt(options: CaptureOptions) {
    const { time, width = 1920, height = 1080, preset = 'overview', quality = 'high' } = options;
    if (!Number.isFinite(time) || time < 0 || time > 1e12) throw new RangeError('Time outside supported range: 0–1e12 seconds.');
    if (![width, height].every(n => Number.isInteger(n) && n >= 64 && n <= 4096)) throw new RangeError('Capture dimensions must be integers between 64 and 4096.');
    if (!(quality in PROFILES)) throw new RangeError('Unknown quality profile.');
    const camera = new PerspectiveCamera(45, width / height, 0.1, 1000);
    const pose = options.camera ?? presetPose(preset, width / height);
    if (![pose.radius,pose.polar,pose.azimuth,...pose.target].every(Number.isFinite) || pose.radius < 14.5 || pose.radius > 140 || Math.hypot(...pose.target) > 2.5) throw new RangeError('Capture camera is outside the observation boundary.');
    camera.position.setFromSpherical(new Spherical(pose.radius, Math.max(0.08, Math.min(Math.PI / 2 - 0.045, pose.polar)), pose.azimuth)).add(new Vector3(...pose.target));
    camera.lookAt(new Vector3(...pose.target));
    camera.updateMatrixWorld();
    const destination = new WebGLRenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false, stencilBuffer: false });
    const pixels = new Uint8Array(width * height * 4);
    const old = { width: this.pipeline.width, height: this.pipeline.height, quality: this.pipeline.quality, pixelRatio: this.pipeline.renderer.getPixelRatio() };
    try {
      this.pipeline.resize(width, height, quality, 1);
      // Warm newly allocated HDR and postprocess attachments at this exact timestamp.
      // Read only the settled frame, independent of the preceding live viewport/quality.
      this.pipeline.render(camera, time, this.appearance, destination);
      this.pipeline.render(camera, time, this.appearance, destination);
      this.pipeline.renderer.readRenderTargetPixels(destination, 0, 0, width, height, pixels);
    } finally {
      destination.dispose();
      this.pipeline.resize(old.width, old.height, old.quality, old.pixelRatio);
      this.restore();
    }
    const imageData = new ImageData(width, height);
    let hash = 2166136261, nonBlack = 0, total = 0, clipped = 0;
    for (let y = 0; y < height; y++) {
      const source = (height - y - 1) * width * 4;
      imageData.data.set(pixels.subarray(source, source + width * 4), y * width * 4);
    }
    for (let i = 0; i < pixels.length; i += 4) {
      for (let c = 0; c < 3; c++) { hash = Math.imul(hash ^ pixels[i + c], 16777619); total += pixels[i + c]; }
      if (Math.max(pixels[i],pixels[i+1],pixels[i+2]) > 8) nonBlack++;
      if (Math.min(pixels[i],pixels[i+1],pixels[i+2]) > 250) clipped++;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d')!.putImageData(imageData, 0, 0);
    return { time, width, height, quality, camera: pose, hash: (hash >>> 0).toString(16).padStart(8,'0'),
      nonBlackFraction: nonBlack / (width * height), mean: total / (width * height * 3), clippedFraction: clipped / (width * height),
      dataUrl: canvas.toDataURL('image/png') };
  }

  download(options: CaptureOptions) {
    const result = this.renderAt(options);
    const a = document.createElement('a');
    a.href = result.dataUrl;
    a.download = `liminal-${options.time.toFixed(2)}s-${result.width}x${result.height}.png`;
    a.click();
    return result;
  }
}
