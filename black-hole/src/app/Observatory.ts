import { CameraRig, type ViewName } from '../camera/CameraRig';
import { CaptureController, type CaptureOptions } from '../capture/Capture';
import { RenderPipeline } from '../rendering/Pipeline';
import { PROFILES, QualityController, type QualityMode } from '../quality/Quality';
import { SimulationClock } from '../simulation/Clock';
import { DEFAULT_APPEARANCE } from '../simulation/model';
import { ObservatoryUI } from '../ui/Interface';
import { mountNavigation } from '../../../platform/navigation';
import { readSession, rememberScene } from '../../../platform/session';
import type { CameraPose } from '../camera/CameraRig';

export class Observatory {
  private readonly canvas = document.querySelector<HTMLCanvasElement>('#universe')!;
  private readonly events = new AbortController();
  private readonly clock = new SimulationClock();
  private readonly appearance = { ...DEFAULT_APPEARANCE };
  private pipeline!: RenderPipeline;
  private camera!: CameraRig;
  private quality!: QualityController;
  private ui!: ObservatoryUI;
  private capture!: CaptureController;
  private raf = 0;
  private previousFrame = 0;
  private previousUI = 0;
  private ready = false;
  private disposed = false;
  private contextLost = false;
  private pendingResize = false;
  private detachNavigation?: () => void;
  private detachSession?: () => void;
  private readonly pointers = new Set<number>();
  private press: { x: number; y: number; time: number; multi: boolean } | null = null;
  private readonly resizeObserver = new ResizeObserver(() => { this.pendingResize = true; });

  async start() {
    this.pipeline = new RenderPipeline(this.canvas);
    this.quality = new QualityController(this.pipeline.capabilities, () => { this.resize(); this.syncUI(); });
    this.camera = new CameraRig(this.canvas, () => { if (this.ready) this.syncUI(); });
    this.clock.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ui = new ObservatoryUI({
      view: view => this.camera.goTo(view), pause: () => this.togglePause(), cruise: () => this.camera.toggleCruise(),
      zoom: factor => this.camera.zoom(factor),
      speed: speed => { this.clock.speed = speed; this.syncUI(); },
      quality: mode => this.quality.setMode(mode),
      appearance: (key,value) => { this.appearance[key] = value; },
      capture: specified => this.download(specified),
    });
    this.detachNavigation = mountNavigation('black-hole');
    this.capture = new CaptureController(this.pipeline, this.appearance, () => this.render());
    this.resize();
    await this.pipeline.initialize();
    if (this.disposed) return;
    this.ready = true;
    this.restoreObservation();
    document.documentElement.dataset.sceneReady = 'true';
    this.detachSession = rememberScene('black-hole', () => ({ ...this.getState(), portrait: innerWidth < innerHeight }));
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
    window.addEventListener('pageshow', event => { if (event.persisted && this.disposed) location.reload(); });
    document.getElementById('loading')!.hidden = true;
    this.installEvents();
    this.installAPI();
    this.resizeObserver.observe(document.getElementById('app')!);
    this.clock.setSuspended(document.hidden);
    this.syncUI();
    this.render();
    if (!document.hidden) this.raf = requestAnimationFrame(this.frame);
  }

  private installEvents() {
    const signal = this.events.signal;
    document.addEventListener('visibilitychange', this.visibilityChanged, { signal });
    document.addEventListener('freeze', () => { cancelAnimationFrame(this.raf); this.clock.setSuspended(true); }, { signal });
    document.addEventListener('resume', this.visibilityChanged, { signal });
    window.addEventListener('pageshow', this.visibilityChanged, { signal });
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.contextLost = true;
      cancelAnimationFrame(this.raf); this.clock.setSuspended(true);
      this.pipeline.invalidateLostResources();
      this.ui.notice('图形上下文已暂停，正在等待浏览器恢复。');
    }, { signal });
    this.canvas.addEventListener('webglcontextrestored', async () => {
      try {
        this.contextLost = false;
        await this.pipeline.initialize();
        this.resize(); this.visibilityChanged(); this.ui.notice('观测画面已恢复。');
      } catch (error) { this.fail(error); }
    }, { signal });
    this.canvas.addEventListener('pointerdown', event => {
      this.pointers.add(event.pointerId);
      if (this.pointers.size > 1 && this.press) this.press.multi = true;
      else this.press = { x: event.clientX, y: event.clientY, time: performance.now(), multi: false };
    }, { signal });
    this.canvas.addEventListener('pointerup', event => {
      this.pointers.delete(event.pointerId);
      if (this.press && !this.press.multi && performance.now() - this.press.time < 450 && Math.hypot(event.clientX-this.press.x,event.clientY-this.press.y) < 6) {
        const rect = this.canvas.getBoundingClientRect();
        const pick = this.pipeline.pick((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2,this.camera.camera,this.clock.time,this.appearance);
        if (pick.structure === 'disk') { this.camera.focusDisk(pick.radius,pick.angle); this.ui.notice('靠近吸积盘 · 拖动即可接管镜头'); }
        else if (pick.structure === 'lensed-disk') { this.camera.goTo('edge'); this.ui.notice('观察盘面的引力透镜影像'); }
        else if (pick.structure === 'shadow') { this.camera.goTo('overview'); this.ui.notice('黑洞阴影 · 它大于事件视界'); }
      }
      if (!this.pointers.size) this.press = null;
    }, { signal });
    this.canvas.addEventListener('pointercancel', event => { this.pointers.delete(event.pointerId); this.press = null; }, { signal });
  }

  private visibilityChanged = () => {
    cancelAnimationFrame(this.raf);
    this.clock.setSuspended(document.hidden || this.contextLost);
    this.previousFrame = 0;
    this.quality.resetSampling();
    if (!document.hidden && !this.contextLost && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  };

  private resize() {
    this.pendingResize = false;
    const width = Math.max(1,this.canvas.clientWidth), height = Math.max(1,this.canvas.clientHeight);
    this.camera.resize(width,height);
    this.pipeline.resize(width,height,this.quality.current);
  }

  private frame = (now: number) => {
    if (this.disposed || this.contextLost || document.hidden) return;
    if (this.pendingResize) this.resize();
    const dt = this.clock.tick(now);
    this.camera.update(dt,this.clock.paused);
    this.render();
    if (this.previousFrame) this.quality.sample(now-this.previousFrame,now);
    this.previousFrame = now;
    if (now-this.previousUI >= 500) { this.syncUI(); this.previousUI=now; }
    this.raf=requestAnimationFrame(this.frame);
  };

  private render() { if (this.ready && !this.contextLost) this.pipeline.render(this.camera.camera,this.clock.time,this.appearance); }

  private togglePause() { this.clock.paused=!this.clock.paused; this.clock.resetDelta(); this.syncUI(); }

  private syncUI() {
    this.ui?.sync({ paused: this.clock.paused, cruise: this.camera.cruising, speed: this.clock.speed, view: this.camera.view,
      fps: this.quality.fps, quality: PROFILES[this.quality.current].label, distance: this.camera.camera.position.length(), time: this.clock.time });
  }

  private download(specified: boolean) {
    try {
      const captureScale = Math.min(1,4096/Math.max(this.canvas.width,this.canvas.height));
      this.capture.download(specified ? { ...this.ui.captureSettings(), quality: 'high', preset: 'overview' } : {
        time: this.clock.time, width: Math.round(this.canvas.width*captureScale), height: Math.round(this.canvas.height*captureScale), camera: this.camera.pose(), quality: this.quality.current,
      });
      this.clock.resetDelta(); this.quality.resetSampling();
      this.ui.notice('画面已保存为 PNG。');
    } catch(error) { this.ui.notice(error instanceof Error ? error.message : '画面导出失败。'); }
  }

  private getState() {
    return { ready: this.ready, time: this.clock.time, paused: this.clock.paused, speed: this.clock.speed, suspended: this.clock.suspended,
      cruise: this.camera.cruising, view: this.camera.view, transitioning: this.camera.transitioning, camera: this.camera.pose(),
      position: this.camera.camera.position.toArray(), target: this.camera.controls.target.toArray(),
      quality: this.quality.current, qualityMode: this.quality.mode, fps: this.quality.fps, frameMs: this.quality.frameMs,
      qualityHistory: [...this.quality.history], appearance: { ...this.appearance }, ...this.pipeline.info() };
  }

  private restoreObservation() {
    const saved = readSession<Record<string, unknown>>('black-hole');
    if (!saved) {
      this.camera.toggleCruise();
      return;
    }
    if (typeof saved.paused === 'boolean') this.clock.paused = saved.paused;
    if (typeof saved.time === 'number' && Number.isFinite(saved.time) && saved.time >= 0 && saved.time <= 1e12) this.clock.setTime(saved.time);
    if (typeof saved.speed === 'number' && [0.25,0.5,1,2,4].includes(saved.speed)) this.clock.speed = saved.speed;
    if (typeof saved.qualityMode === 'string' && ['auto','low','medium','high','ultra'].includes(saved.qualityMode)) {
      this.quality.setMode(saved.qualityMode as QualityMode);
      document.querySelector<HTMLSelectElement>('#quality')!.value = saved.qualityMode;
    }
    const appearance = saved.appearance as Record<string, unknown> | undefined;
    for (const key of ['exposure','bloom','diskIntensity','stars'] as const) {
      const input = document.getElementById(key) as HTMLInputElement;
      const value = appearance?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        this.appearance[key] = Math.max(Number(input.min), Math.min(Number(input.max), value));
        input.value = String(this.appearance[key]);
        document.getElementById(`${key}-value`)!.textContent = this.appearance[key].toFixed(2);
      }
    }
    const pose = saved.camera as CameraPose | undefined;
    if (pose && [pose.radius,pose.polar,pose.azimuth].every(Number.isFinite) && Array.isArray(pose.target) && pose.target.length === 3 && pose.target.every(n => Number.isFinite(n) && Math.abs(n) < 10)) {
      const restored = { ...pose };
      if (saved.portrait !== (innerWidth < innerHeight)) restored.radius *= innerWidth < innerHeight ? 50/27 : 27/50;
      this.camera.applyPose(restored);
      this.camera.view = ['overview','edge','disk','top','free'].includes(String(saved.view)) ? saved.view as ViewName | 'free' : 'free';
      if (saved.cruise === true) this.camera.toggleCruise();
    }
    this.syncUI();
  }

  private installAPI() {
    window.observatory = {
      version: '1.0.0', getState: () => this.getState(),
      setTime: (time: number) => { this.clock.setTime(time); this.render(); },
      setPaused: (paused: boolean) => { this.clock.paused=paused; this.clock.resetDelta(); this.syncUI(); },
      setQuality: (mode: QualityMode) => this.quality.setMode(mode),
      setView: (view: ViewName, immediate = false) => this.camera.goTo(view,immediate),
      toggleCruise: () => this.camera.toggleCruise(),
      renderAt: (options: CaptureOptions) => {
        const result=this.capture.renderAt(options);
        this.clock.resetDelta(); this.quality.resetSampling();
        return result;
      },
      pick: (x: number,y: number) => this.pipeline.pick(x*2-1,1-y*2,this.camera.camera,this.clock.time,this.appearance),
      pickVacuum: (x: number,y: number) => this.pipeline.pick(x*2-1,1-y*2,this.camera.camera,this.clock.time,this.appearance,true),
      dispose: () => this.dispose(),
    };
  }

  fail(error: unknown) {
    console.error(error);
    document.getElementById('loading')!.hidden=true;
    const fatal=document.getElementById('fatal')!;
    fatal.hidden=false;
    fatal.textContent=error instanceof Error ? error.message : '无法启动观测站。请刷新页面重试。';
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed=true; this.ready=false;
    cancelAnimationFrame(this.raf);
    this.events.abort(); this.resizeObserver.disconnect();
    this.ui?.dispose(); this.camera?.dispose(); this.pipeline?.dispose();
    this.detachNavigation?.(); this.detachSession?.();
    delete window.observatory;
  }
}

declare global {
  interface Window {
    observatory?: {
      version: string;
      getState: () => ReturnType<Observatory['getState']>;
      setTime: (time: number) => void;
      setPaused: (paused: boolean) => void;
      setQuality: (mode: QualityMode) => void;
      setView: (view: ViewName, immediate?: boolean) => void;
      toggleCruise: () => void;
      renderAt: (options: CaptureOptions) => ReturnType<CaptureController['renderAt']>;
      pick: (x: number,y: number) => ReturnType<RenderPipeline['pick']>;
      pickVacuum: (x: number,y: number) => ReturnType<RenderPipeline['pick']>;
      dispose: () => void;
    };
  }
}
