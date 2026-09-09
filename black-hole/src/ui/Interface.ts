import { createIcons, Aperture, ArrowDownToLine, ArrowLeft, Camera, Check, ChevronDown, CircleHelp, Compass, Expand, Focus, Gauge, Info, Minus, Orbit, Pause, Play, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide';
import type { Appearance } from '../simulation/model';
import type { QualityMode } from '../quality/Quality';
import type { ViewName } from '../camera/CameraRig';

const icons = { Aperture, ArrowDownToLine, ArrowLeft, Camera, Check, ChevronDown, CircleHelp, Compass, Expand, Focus, Gauge, Info, Minus, Orbit, Pause, Play, Plus, RotateCcw, SlidersHorizontal, X };
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const button = (id: string, glyph: string, label: string, extra = '') => `<button id="${id}" class="icon-button" aria-label="${label}" data-tip="${label}" ${extra}>${icon(glyph)}</button>`;

export interface UIActions {
  view: (view: ViewName) => void;
  pause: () => void;
  cruise: () => void;
  zoom: (factor: number) => void;
  speed: (speed: number) => void;
  quality: (quality: QualityMode) => void;
  appearance: (key: keyof Appearance, value: number) => void;
  capture: (specified: boolean) => void;
}

export interface UIState { paused: boolean; cruise: boolean; speed: number; view: string; fps: number; quality: string; distance: number; time: number }

export class ObservatoryUI {
  private readonly root = document.querySelector<HTMLDivElement>('#interface')!;
  private readonly events = new AbortController();
  private activePanel: string | null = null;
  private noticeTimer = 0;
  private lastState = '';
  private readonly statusCache = new Map<string,string>();

  constructor(private readonly actions: UIActions) {
    this.root.innerHTML = `
      <header class="topbar">
        <div id="scene-navigation"></div>
        <div class="top-actions">
          ${button('settings-button','sliders-horizontal','观测设置','aria-expanded="false" aria-controls="settings-panel"')}
          ${button('science-button','info','关于这座黑洞','aria-expanded="false" aria-controls="science-panel"')}
          ${button('fullscreen-button','expand','进入全屏')}
        </div>
      </header>
      <div class="observation-index"><span class="live-dot"></span><span>OBSERVATION 001</span></div>
      <div class="gesture-hint" id="gesture-hint"><span class="desktop-hint">拖动环绕 · 滚轮靠近 · 点击亮弧探索</span><span class="mobile-hint">单指环绕 · 双指靠近 · 轻触亮弧</span></div>
      <nav class="dock" aria-label="观测工具栏">
        ${button('home-button','rotate-ccw','返回全景')}
        <button id="views-button" class="view-button" aria-label="选择观察视角" aria-expanded="false" aria-controls="views-panel">${icon('aperture')}<span id="view-name">整体</span>${icon('chevron-down')}</button>
        <span class="divider"></span>
        ${button('cruise-button','orbit','自动巡游','aria-pressed="false"')}
        ${button('pause-button','pause','暂停时间','aria-pressed="false"')}
        <button id="speed-button" class="speed-button" aria-label="时间倍速，当前 1 倍">1×</button>
        <span class="divider"></span>
        ${button('capture-button','camera','保存当前画面')}
      </nav>
      <div class="zoom-control" aria-label="缩放控制">${button('zoom-in','plus','靠近')}${button('zoom-out','minus','远离')}</div>
      <footer class="readout"><div><span class="readout-title">SCHWARZSCHILD</span><span class="readout-sub">无自旋 · 单一黑洞</span></div><div class="live-status"><span class="live-dot"></span><span id="live-text">观测进行中</span></div></footer>
      <section id="views-panel" class="views-popover" aria-label="观察视角" hidden>
        <div class="popover-caption">选择你的观察位置</div>
        <button data-view="overview"><span class="view-number">01</span><div>整体<span>阴影与引力透镜</span></div>${icon('focus')}</button>
        <button data-view="edge"><span class="view-number">02</span><div>侧面<span>光线绕过黑洞</span></div>${icon('aperture')}</button>
        <button data-view="disk"><span class="view-number">03</span><div>吸积盘细节<span>靠近流动的物质</span></div>${icon('orbit')}</button>
        <button data-view="top"><span class="view-number">04</span><div>俯瞰<span>旋转中的盘面</span></div>${icon('compass')}</button>
      </section>
      <aside id="settings-panel" class="side-panel" aria-labelledby="settings-title" hidden>
        <div class="panel-header"><div><span class="eyebrow">OBSERVATION CONTROLS</span><h1 id="settings-title">调节观测</h1></div>${button('close-settings','x','关闭观测设置')}</div>
        <div class="panel-content">
          <div class="section-label">画面</div>
          <label class="slider-label" for="exposure">曝光 <output id="exposure-value">1.15</output></label><input id="exposure" data-appearance="exposure" type="range" min="0.4" max="2.4" step="0.05" value="1.15" />
          <label class="slider-label" for="bloom">辉光 <output id="bloom-value">0.28</output></label><input id="bloom" data-appearance="bloom" type="range" min="0" max="0.7" step="0.01" value="0.28" />
          <label class="slider-label" for="diskIntensity">盘面亮度 <output id="diskIntensity-value">1.00</output></label><input id="diskIntensity" data-appearance="diskIntensity" type="range" min="0.3" max="2" step="0.05" value="1" />
          <label class="slider-label" for="stars">星光 <output id="stars-value">1.00</output></label><input id="stars" data-appearance="stars" type="range" min="0" max="2" step="0.05" value="1" />
          <p class="field-note">这些控制调节显示效果，不改变黑洞的物理结构。</p>
          <div class="section-label">画质与运行</div>
          <label class="select-row" for="quality">画质<select id="quality"><option value="auto">自动适配</option><option value="low">节能</option><option value="medium">均衡</option><option value="high">精细</option><option value="ultra">极致</option></select></label>
          <div class="metrics"><div><span id="fps-value">—</span><small>帧 / 秒</small></div><div><span id="distance-value">27.0</span><small>距离 / Rₛ</small></div><div><span id="quality-value">精细</span><small>当前画质</small></div></div>
          <div class="section-label">影像记录</div>
          <label class="select-row" for="capture-format">画幅<select id="capture-format"><option value="1920x1080">横屏 · 1920 × 1080</option><option value="1080x1920">竖屏 · 1080 × 1920</option></select></label>
          <label class="select-row" for="capture-time">指定时刻 / 秒<input id="capture-time" type="number" min="0" max="1000000000000" step="0.1" value="24" /></label>
          <button id="render-frame" class="primary-button">${icon('arrow-down-to-line')}导出该时刻的全景</button>
          <p class="field-note">使用固定全景与精细画质。相同时刻可重复生成，适合逐帧制作影片。</p>
          <div class="section-label">操作</div>
          <p class="shortcut-note"><kbd>空格</kbd> 暂停 / 恢复　<kbd>1–4</kbd> 视角<br><kbd>C</kbd> 巡游　<kbd>R</kbd> 全景　<kbd>＋ / −</kbd> 缩放</p>
        </div>
      </aside>
      <aside id="science-panel" class="side-panel science-panel" aria-labelledby="science-title" hidden>
        <div class="panel-header"><div><span class="eyebrow">BEYOND THE VISIBLE</span><h1 id="science-title">看见不可见</h1></div>${button('close-science','x','关闭科学说明')}</div>
        <div class="panel-content">
          <p class="science-lead">你看见的黑暗，<br>比事件视界更大。</p>
          <p>这是一座无自旋、无电荷的 <strong>Schwarzschild 黑洞</strong>。它弯曲来自吸积盘与远方星空的光线，盘面背后的光因此出现在黑洞上方与下方。</p>
          <div class="science-values"><div><b>1</b><span>事件视界 / Rₛ</span></div><div><b>1.5</b><span>光子球 / Rₛ</span></div><div><b>2.598</b><span>远场阴影临界半径 / Rₛ</span></div></div>
          <h2>阴影 ≠ 事件视界</h2><p>Rₛ = 2GM/c²。事件视界是光无法逃离的边界；阴影是捕获与光线偏折造成的暗区。2.598 Rₛ 是远处观测者的临界冲击参数，不是一个实体表面的半径。发光薄盘也会覆盖部分暗区。</p>
          <h2>同一条光线，多个盘面影像</h2><p>着色器对零测地线方程 u″ = 1.5u² − u（u = Rₛ/r）进行四阶 Runge–Kutta 积分。盘面从 3 Rₛ 的最内稳定圆轨道延伸至 9 Rₛ。接近光子球的光可绕行，形成逐渐变窄的高阶影像；屏幕分辨率只保留其中有限部分。</p>
          <h2>亮度为何不对称</h2><p>盘面沿圆轨道运动，接近观察者的一侧因多普勒增亮更亮。这里同时近似计算引力红移与 g³ 比强度权重；金白至橙红的颜色映射经过艺术调色，并非真实可见光观测。</p>
          <h2>这份模拟的边界</h2><p>使用理想薄盘和程序化湍流，不是磁流体求解。盘面不透明度、辉光与流动速度为展示调整。未计算自旋、喷流、光行时差、完整辐射转移与观察者运动的相对论像差。背景是固定种子的合成星空，星点以有限角尺寸纹理采样，临界曲线附近可能拉长或闪烁。</p>
          <p>模型以 Rₛ 归一化，因此不提供会误导的质量或自旋滑块；计时单位是演示秒，不对应某个实测黑洞的物理时间。</p>
          <div class="source-links"><span class="section-label">科学参考</span><a href="https://www.nasa.gov/universe/nasa-visualization-shows-a-black-holes-warped-world/" target="_blank" rel="noopener noreferrer">NASA · 黑洞的扭曲世界 ↗</a><a href="https://arxiv.org/abs/2010.08735" target="_blank" rel="noopener noreferrer">Bruneton (2020) · 非旋转黑洞实时渲染 ↗</a><a href="https://arxiv.org/abs/1910.02957" target="_blank" rel="noopener noreferrer">Narayan 等 (2019) · 黑洞阴影 ↗</a></div>
        </div>
      </aside>`;
    createIcons({ icons, attrs: { 'stroke-width': 1.55 } });
    const on = (id: string, callback: () => void) => document.getElementById(id)!.addEventListener('click', callback, { signal: this.events.signal });
    on('settings-button', () => this.togglePanel('settings'));
    on('science-button', () => this.togglePanel('science'));
    on('views-button', () => this.togglePanel('views'));
    on('close-settings', () => this.closePanel()); on('close-science', () => this.closePanel());
    on('home-button', () => actions.view('overview'));
    on('cruise-button', actions.cruise); on('pause-button', actions.pause);
    on('zoom-in', () => actions.zoom(0.82)); on('zoom-out', () => actions.zoom(1.22));
    on('capture-button', () => actions.capture(false)); on('render-frame', () => actions.capture(true));
    on('speed-button', () => {
      const button = document.getElementById('speed-button')!;
      const current = parseFloat(button.textContent!);
      const speeds = [0.25,0.5,1,2,4];
      actions.speed(speeds[(speeds.indexOf(current)+1)%speeds.length]);
    });
    on('fullscreen-button', () => {
      const promise = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
      if (promise) promise.catch(() => this.notice('此浏览器不支持切换全屏。'));
      else this.notice('此浏览器可通过“添加到主屏幕”获得全屏体验。');
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => { actions.view(button.dataset.view as ViewName); this.closePanel(); }, { signal: this.events.signal }));
    this.root.querySelectorAll<HTMLInputElement>('[data-appearance]').forEach(input => input.addEventListener('input', () => {
      const key = input.dataset.appearance as keyof Appearance;
      actions.appearance(key, Number(input.value));
      document.getElementById(`${key}-value`)!.textContent = Number(input.value).toFixed(2);
    }, { signal: this.events.signal }));
    document.querySelector<HTMLSelectElement>('#quality')!.addEventListener('change', event => actions.quality((event.target as HTMLSelectElement).value as QualityMode), { signal: this.events.signal });
    document.addEventListener('keydown', this.keyDown, { signal: this.events.signal });
    document.addEventListener('pointerdown', event => {
      if (this.activePanel === 'views' && !(event.target as Element).closest('#views-panel,#views-button')) this.closePanel(false);
    }, { signal: this.events.signal });
    document.querySelector('#universe')!.addEventListener('pointerdown', () => document.getElementById('gesture-hint')!.classList.add('dismissed'), { signal: this.events.signal });
  }

  private keyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).matches('input,select,textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') { this.closePanel(); return; }
    if (event.code === 'Space' && !(event.target as HTMLElement).closest('button')) { event.preventDefault(); this.actions.pause(); }
    if (key === 'c') this.actions.cruise();
    if (key === 'r') this.actions.view('overview');
    if (['1','2','3','4'].includes(key)) this.actions.view((['overview','edge','disk','top'] as const)[Number(key)-1]);
    if (key === '+' || key === '=') this.actions.zoom(0.82);
    if (key === '-') this.actions.zoom(1.22);
    if (key === 'tab' && this.activePanel && this.activePanel !== 'views') {
      const panel = document.getElementById(`${this.activePanel}-panel`)!;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button,a,input,select'));
      const first = focusable[0], last = focusable[focusable.length-1];
      if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    }
  };

  togglePanel(name: string) {
    const open = this.activePanel !== name;
    this.closePanel(false);
    if (open) {
      this.activePanel = name;
      const panel = document.getElementById(`${name}-panel`)!;
      panel.hidden = false;
      if (name !== 'views') document.querySelector<HTMLElement>('.zoom-control')!.hidden = true;
      document.getElementById(`${name === 'science' ? 'science' : name === 'settings' ? 'settings' : 'views'}-button`)!.setAttribute('aria-expanded','true');
      panel.querySelector<HTMLElement>('button')?.focus();
    }
  }

  closePanel(focus = true) {
    if (!this.activePanel) return;
    const name = this.activePanel;
    document.getElementById(`${name}-panel`)!.hidden = true;
    const button = document.getElementById(`${name}-button`)!;
    button.setAttribute('aria-expanded', 'false');
    this.activePanel = null;
    document.querySelector<HTMLElement>('.zoom-control')!.hidden = false;
    if (focus) button.focus();
  }

  sync(state: UIState) {
    const signature = `${state.paused}/${state.cruise}/${state.speed}/${state.view}`;
    if (signature !== this.lastState) {
      this.lastState = signature;
      const pause = document.getElementById('pause-button')!;
      pause.innerHTML = icon(state.paused ? 'play' : 'pause');
      pause.setAttribute('aria-label',state.paused ? '恢复时间' : '暂停时间');
      pause.dataset.tip = state.paused ? '恢复时间' : '暂停时间';
      pause.setAttribute('aria-pressed',String(state.paused));
      document.getElementById('cruise-button')!.setAttribute('aria-pressed',String(state.cruise));
      document.getElementById('speed-button')!.textContent = `${state.speed}×`;
      document.getElementById('speed-button')!.setAttribute('aria-label',`时间倍速，当前 ${state.speed} 倍`);
      document.getElementById('view-name')!.textContent = ({overview:'整体',edge:'侧面',disk:'盘面',top:'俯瞰',free:'自由'} as Record<string,string>)[state.view];
      document.getElementById('live-text')!.textContent = state.paused ? '时间已暂停' : state.cruise ? '自动巡游中' : '观测进行中';
      document.querySelector('.live-status')!.classList.toggle('paused',state.paused);
      createIcons({ icons, attrs: { 'stroke-width': 1.55 } });
    }
    if (this.activePanel === 'settings') {
      this.setText('fps-value',state.fps.toFixed(0));
      this.setText('distance-value',state.distance.toFixed(1));
      this.setText('quality-value',state.quality);
    }
  }

  private setText(id: string, text: string) {
    if (this.statusCache.get(id) === text) return;
    this.statusCache.set(id,text); document.getElementById(id)!.textContent = text;
  }

  notice(message: string) {
    const notice = document.getElementById('notice')!;
    notice.textContent = message; notice.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 3200);
  }

  captureSettings() {
    const [width,height] = document.querySelector<HTMLSelectElement>('#capture-format')!.value.split('x').map(Number);
    const time = Number(document.querySelector<HTMLInputElement>('#capture-time')!.value);
    return { width,height,time };
  }

  dispose() { this.events.abort(); clearTimeout(this.noticeTimer); this.root.innerHTML = ''; }
}
