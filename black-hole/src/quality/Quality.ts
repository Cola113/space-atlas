export type QualityName = 'low' | 'medium' | 'high' | 'ultra';
export type QualityMode = 'auto' | QualityName;

export const PROFILES = {
  low: { label: '节能', scale: 0.65, pixelCap: 1, steps: 224, stepSize: 0.061, bloom: false },
  medium: { label: '均衡', scale: 0.82, pixelCap: 1.25, steps: 320, stepSize: 0.043, bloom: true },
  high: { label: '精细', scale: 1, pixelCap: 1.5, steps: 448, stepSize: 0.030, bloom: true },
  ultra: { label: '极致', scale: 1, pixelCap: 2, steps: 640, stepSize: 0.0215, bloom: true },
} as const;

export interface Capabilities {
  webgl2: boolean;
  floatBuffer: boolean;
  gpu: string;
  mobile: boolean;
  maxTextureSize: number;
}

export function detectCapabilities(gl: WebGL2RenderingContext): Capabilities {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl2: true,
    floatBuffer: !!gl.getExtension('EXT_color_buffer_float'),
    gpu: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    mobile: matchMedia('(pointer: coarse)').matches || innerWidth < 700,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
}

export class QualityController {
  mode: QualityMode = 'auto';
  current: QualityName;
  fps = 60;
  frameMs = 16.7;
  private duration = 0;
  private count = 0;
  private lastChange = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  readonly history: { at: number; quality: QualityName; fps: number }[] = [];

  constructor(readonly capabilities: Capabilities, readonly onChange: () => void) {
    this.current = capabilities.mobile ? 'medium' : 'high';
  }

  setMode(mode: QualityMode) {
    this.mode = mode;
    this.slowWindows = this.fastWindows = 0;
    this.lastChange = performance.now();
    if (mode !== 'auto') this.current = mode;
    this.onChange();
  }

  sample(frameMs: number, now: number) {
    if (frameMs <= 0 || frameMs > 250) return;
    this.duration += frameMs;
    this.count++;
    if (this.duration < 2500) return;
    this.frameMs = this.duration / this.count;
    this.fps = 1000 / this.frameMs;
    this.duration = this.count = 0;
    if (this.mode !== 'auto' || now - this.lastChange < 15000) return;
    this.slowWindows = this.fps < (this.capabilities.mobile ? 26 : 40) ? this.slowWindows + 1 : 0;
    this.fastWindows = this.fps > 57 ? this.fastWindows + 1 : 0;
    const levels: QualityName[] = ['low', 'medium', 'high'];
    let index = levels.indexOf(this.current);
    if (index < 0) index = 2;
    const ceiling = this.capabilities.mobile ? 1 : 2;
    if (this.slowWindows >= 3 && index > 0) index--;
    else if (this.fastWindows >= 8 && index < ceiling) index++;
    else return;
    this.current = levels[index];
    this.history.push({ at: now, quality: this.current, fps: this.fps });
    this.lastChange = now;
    this.slowWindows = this.fastWindows = 0;
    this.onChange();
  }

  resetSampling() { this.duration = this.count = this.slowWindows = this.fastWindows = 0; }
}
