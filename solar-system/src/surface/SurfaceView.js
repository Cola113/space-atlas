import * as THREE from 'three';
import { landingSites, surfaceFrame, angularDiameter, horizonAngles, lookDirection } from './geometry.js';
import { SurfaceClock } from './SurfaceClock.js';
import { simulationRates, formatSimulationRate, simulationRateEquivalent } from '../simulation-time.js';
import { SurfaceJourney } from './SurfaceJourney.js';
import { createSurfaceSky, surfaceCameraRange } from './SurfaceSky.js';
import './surface.css';

const rad = THREE.MathUtils.degToRad;
const deg = THREE.MathUtils.radToDeg;
const compass = angle => ['北','东北','东','东南','南','西南','西','西北'][Math.round(angle / 45) % 8];

// Camera position is fixed. A brief lens/attitude change settles the arrival;
// after landing, only the look direction changes. Time and rate carry across views.
export function createSurfaceView(id, {renderOrbit,onClosed,initialDate,initialRate,onRateChange,onTimeChange}) {
  const site = landingSites[id];
  if (!site) throw new Error('这个天体还没有开放着陆点。');
  const parsedDate = initialDate instanceof Date ? initialDate.getTime()
    : (typeof initialDate === 'number' ? initialDate : Date.parse(initialDate || site.date));
  const startTime = Number.isFinite(parsedDate) ? parsedDate : Date.parse(site.date);
  let frame = surfaceFrame(site,new Date(startTime));
  const clock = new SurfaceClock(startTime,initialRate,onTimeChange);
  const journey = new SurfaceJourney(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = document.createElement('dialog');
  root.className = 'surface-view';
  root.dataset.phase = journey.phase;
  root.setAttribute('aria-label', `${site.name}表面观景`);
  root.innerHTML = `
    <div class="surface-canvas"></div>
    <div class="surface-vignette" aria-hidden="true"></div>
    <header class="surface-header">
      <button class="surface-exit" type="button">← <span>返回轨道</span></button>
      <span class="surface-mode"><b></b> SURFACE EXPLORER</span>
      <button class="surface-info-button" type="button" aria-expanded="false" aria-controls="surface-details">观景说明 <span>ⓘ</span></button>
    </header>
    <div class="surface-location"><span class="surface-eyebrow">${site.english}</span>
      <h1>${site.name}<span>·</span><small>${site.title}</small></h1>
      <p>${site.provenance}</p></div>
    <div class="surface-target" hidden><span></span><small></small></div>
    <div class="surface-crosshair" aria-hidden="true"></div>
    <section class="surface-details" id="surface-details" aria-label="观景说明" hidden>
      <button class="surface-details-close" type="button" aria-label="关闭观景说明">×</button>
      <span class="surface-eyebrow">这个视野从哪里来</span><h2>${site.title}</h2>
      <p>${site.description}</p>
      <dl><div><dt>表面模拟时间</dt><dd class="surface-details-time"></dd></div>
      <div><dt>落点坐标</dt><dd>${site.latitude.toFixed(4)}° N / ${site.longitude.toFixed(4)}° E</dd></div>
      <div><dt>${site.parentName}视直径 / 高度角</dt><dd class="surface-parent-data"></dd></div>
      <div><dt>太阳高度角</dt><dd class="surface-sun-data"></dd></div></dl>
      <p>${site.notes}</p><p>太阳、恒星、卫星方位与天体自转随星历更新，云层与云带流动为视觉模拟。地表随太阳升落和遮挡整体调光；照片中已有的阴影保持原样，不能当作动态地形投影。星点曝光经过增强。</p>
      <p class="surface-credit">${site.credit}</p>
      <p class="surface-links"><a href="${site.source}" target="_blank" rel="noreferrer">地表资料 ↗</a><a href="/surface/README.md" target="_blank" rel="noreferrer">加工与来源 ↗</a></p>
    </section>
    <section class="surface-clock-panel" aria-label="表面时间设置" id="surface-clock-panel" hidden>
      <div class="surface-clock-heading"><span>地表时间</span><button type="button" class="surface-clock-close" aria-label="关闭时间设置">×</button></div>
      <div class="surface-rate-heading"><label for="surface-rate">地表流速 · 与轨道同步</label><output class="surface-rate-value" for="surface-rate">${formatSimulationRate(clock.rate)}</output></div>
      <input id="surface-rate" class="surface-rate" type="range" min="0" max="${simulationRates.length-1}" step="1" value="${simulationRates.indexOf(clock.rate)}">
      <div class="surface-rate-limits" aria-hidden="true"><span>${formatSimulationRate(simulationRates[0])}</span><span>${formatSimulationRate(simulationRates.at(-1))}</span></div>
      <p class="surface-rate-equivalent"></p>
      <div class="surface-clock-actions"><button type="button" class="surface-pause" aria-pressed="false">暂停时间</button><button type="button" class="surface-rewind">回到着陆时刻</button></div>
    </section>
    <footer class="surface-footer"><div class="surface-bearing"><span>朝向</span><strong></strong><small>视点固定 · 眼高 1.65 m</small></div>
      <div class="surface-actions"><button type="button" class="surface-parent">望向${site.parentName} ↗</button>
        <button type="button" class="surface-reset" aria-label="恢复着陆视角">重置视角</button>
        <button type="button" class="surface-photo">留张照片</button></div>
      <div class="surface-time-row"><button type="button" class="surface-time-toggle" aria-expanded="false" aria-controls="surface-clock-panel">地表流速 · ${formatSimulationRate(clock.rate)}</button><time class="surface-time-readout"></time></div>
      <p class="surface-hint">拖动环顾 · ↑ ↓ ← → 转头 · Esc 返回</p></footer>
    <div class="surface-message" role="status" hidden></div>
    <div class="surface-transition-cover" aria-hidden="true"></div>
    <div class="surface-journey-caption" role="status"><span class="surface-eyebrow">DESTINATION / ${site.english}</span><strong>准备前往${site.name}</strong><p>准备地表全景与天空</p><div class="surface-journey-track"><b></b></div></div>
    <button type="button" class="surface-skip">跳过动画</button>`;
  document.body.append(root);
  root.showModal();
  const $ = selector => root.querySelector(selector);
  const events = new AbortController();
  const textures = new Set();
  let renderer, sky, disposed = false, loaded = false, raf = 0, noticeTimer = 0;
  let lastFrame = null, lastDraw = -Infinity, lastSkyUpdate = -Infinity, skyTime = null, lastOrbit = null, dirty = true, lastReadout = '';
  let resetExposure = true, exposureElapsed = 0;
  const initialPitch = () => site.initialPitch + (id === 'europa' && innerWidth < 600 ? 8 : 0);
  let resetPitch = initialPitch();
  let heading = site.initialHeading, pitch = resetPitch, motion = null, drag = null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#020305');
  const camera = new THREE.PerspectiveCamera(62,innerWidth/innerHeight,surfaceCameraRange.near,surfaceCameraRange.far);
  camera.position.set(0,0,0);

  const listen = (target, name, callback, options = {}) => target.addEventListener(name,callback,{...options,signal:events.signal});
  function setClockPanel(open) {
    $('.surface-clock-panel').hidden=!open;
    $('.surface-time-toggle').setAttribute('aria-expanded',String(open));
    if(open)info(false,false);
  }
  function notice(text) {
    $('.surface-message').textContent = text;
    $('.surface-message').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(()=>{$('.surface-message').hidden=true;},4000);
  }
  function info(open, focus = true) {
    $('.surface-details').hidden = !open;
    $('.surface-info-button').setAttribute('aria-expanded',String(open));
    if(open)setClockPanel(false);
    if(focus)(open?$('.surface-details-close'):$('.surface-info-button')).focus();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    events.abort(); clearTimeout(noticeTimer); cancelAnimationFrame(raf);
    scene.traverse(object => { object.geometry?.dispose();
      for (const material of [object.material].flat().filter(Boolean)) material.dispose();
    });
    for (const texture of textures) texture.dispose();
    renderer?.dispose(); renderer?.forceContextLoss();
    root.close(); root.remove();
  }
  function exit() {
    if(disposed)return;
    motion=null;drag=null;setClockPanel(false);info(false,false);
    journey.exit();lastFrame=null;invalidate();
  }
  listen($('.surface-exit'),'click',exit);
  listen(root,'cancel',event=>{event.preventDefault(); if (!$('.surface-details').hidden) info(false); else if(!$('.surface-clock-panel').hidden)setClockPanel(false);else exit();});
  listen($('.surface-info-button'),'click',()=>info($('.surface-details').hidden));
  listen($('.surface-details-close'),'click',()=>info(false));
  listen($('.surface-skip'),'click',()=>{journey.skip();invalidate();});
  listen($('.surface-time-toggle'),'click',()=>setClockPanel($('.surface-clock-panel').hidden));
  listen($('.surface-clock-close'),'click',()=>setClockPanel(false));
  listen($('.surface-rate'),'input',event=>{
    clock.tick(performance.now(),journey.phase==='landed'&&!document.hidden);
    clock.setRate(simulationRates[Number(event.target.value)]);
    onRateChange?.(clock.rate);
    updateReadout();
    invalidate();
  });
  listen($('.surface-pause'),'click',()=>{
    clock.tick(performance.now(),journey.phase==='landed'&&!document.hidden);
    clock.playing=!clock.playing;clock.suspend();lastFrame=null;exposureElapsed=0;invalidate();
  });
  listen($('.surface-rewind'),'click',()=>{clock.reset();lastSkyUpdate=-Infinity;resetExposure=true;exposureElapsed=0;invalidate();});
  listen(document,'visibilitychange',()=>{
    clock.suspend();lastFrame=null;exposureElapsed=0;
    if(document.hidden){cancelAnimationFrame(raf);raf=0;}else invalidate();
  });

  function updateReadout() {
    const time=new Date(clock.time).toISOString().replace('T',' ').slice(0,19)+' UTC';
    if(time!==lastReadout){
      lastReadout=time;$('.surface-time-readout').textContent=time;
      $('.surface-time-readout').dateTime=new Date(clock.time).toISOString();
      $('.surface-details-time').textContent=time;
      const parent=frame.targets[site.parent];
      $('.surface-parent-data').textContent=`${deg(angularDiameter(site.parentRadiusKm,parent.distanceKm)).toFixed(2)}° / ${horizonAngles(parent.direction).altitude.toFixed(1)}°`;
      $('.surface-sun-data').textContent=`${horizonAngles(frame.targets.Sun.direction).altitude.toFixed(1)}°`;
    }
    $('.surface-time-toggle').textContent=clock.playing
      ? `地表流速 · ${formatSimulationRate(clock.rate)}`
      : '时间已暂停';
    const equivalent = simulationRateEquivalent(clock.rate);
    $('.surface-rate-value').textContent=formatSimulationRate(clock.rate);
    $('.surface-rate-equivalent').textContent=equivalent;
    $('.surface-rate').setAttribute('aria-valuetext',`${clock.rate} 倍真实时间，${equivalent}`);
    $('.surface-pause').textContent=clock.playing?'暂停时间':'继续时间';
    $('.surface-pause').setAttribute('aria-pressed',String(!clock.playing));
  }

  function updateCamera(settle = 1) {
    heading = THREE.MathUtils.euclideanModulo(heading,360);
    pitch = THREE.MathUtils.clamp(pitch,-85,89);
    const lens=62+(1-settle)*8;
    if(camera.fov!==lens){camera.fov=lens;camera.updateProjectionMatrix();}
    camera.lookAt(lookDirection(heading,pitch-(1-settle)*10));
    if(settle<1)camera.rotateZ(rad((1-settle)*.8));
    camera.updateMatrixWorld();
    $('.surface-bearing strong').textContent = `${compass(heading)} ${heading.toFixed(0)}°`;
    root.dataset.heading = heading.toFixed(2); root.dataset.pitch = pitch.toFixed(2);
    const parent=frame.targets[site.parent];
    const point = parent.direction.clone().multiplyScalar(500).project(camera);
    const inView = parent.direction.dot(lookDirection(heading,pitch)) > 0 && Math.abs(point.x)<.85 && Math.abs(point.y)<.72;
    const label = $('.surface-target');
    label.hidden = !inView;
    if (inView) {
      label.style.left = `${(point.x*.5+.5)*innerWidth}px`;
      const disc = Math.tan(angularDiameter(site.parentRadiusKm,parent.distanceKm)/2) / Math.tan(rad(camera.fov/2)) * innerHeight*.5;
      label.style.top = `${(-point.y*.5+.5)*innerHeight+disc+17}px`;
      label.querySelector('span').textContent = site.parentName;
      label.querySelector('small').textContent = `${(parent.distanceKm/10000).toFixed(1)} 万公里`;
    }
  }
  function render(now = performance.now()) {
    raf = 0;
    if (disposed || document.hidden) return;
    const dt=lastFrame===null?0:Math.min(Math.max(0,now-lastFrame),100);
    lastFrame=now;
    journey.tick(dt);
    if(journey.phase==='closed'){const finalTime=clock.time;dispose();onClosed(finalTime);return;}
    const sample=journey.sample(), interactive=journey.phase==='landed';
    if(interactive&&clock.playing)exposureElapsed+=dt/1000;
    clock.tick(now,interactive);
    if(root.dataset.phase!==journey.phase){
      root.dataset.phase=journey.phase;dirty=true;
      root.dataset.ready=String(interactive);
      for(const selector of ['.surface-footer','.surface-details','.surface-clock-panel'])$(selector).inert=!interactive;
      $('.surface-info-button').disabled=!interactive;
      if(interactive){motion=null;$('.surface-exit').focus();}
    }
    $('.surface-canvas').hidden=!sample.surface;
    $('.surface-transition-cover').style.opacity=sample.cover;
    const caption={preparing:[`准备前往${site.name}`,'准备地表全景与天空'],approach:[`正在接近${site.name}`,'锁定着陆观景点'],settling:['即将抵达','正在稳定视角'],departing:['离开表面','返回轨道观测'],retreating:['正在返回轨道','恢复原来的观测视角']}[journey.phase];
    if(caption){$('.surface-journey-caption strong').textContent=caption[0];$('.surface-journey-caption p').textContent=caption[1];}
    $('.surface-journey-track b').style.transform=`scaleX(${sample.orbit})`;
    if(!sample.surface && lastOrbit!==sample.orbit){renderOrbit(sample.orbit);lastOrbit=sample.orbit;}
    if(sample.surface)lastOrbit=null;
    if (motion) {
      motion.elapsed+=dt;
      const t = Math.min(1,motion.elapsed/motion.duration), ease=t*t*(3-2*t);
      heading=motion.heading+motion.delta*ease;
      pitch=THREE.MathUtils.lerp(motion.pitch,motion.targetPitch,ease);
      if(t===1) motion=null;
    }
    if(loaded&&sample.surface&&(dirty||motion||!interactive||now-lastDraw>=33)){
      updateCamera(sample.settle);
      if((skyTime!==clock.time&&(now-lastSkyUpdate>=50||dirty))||lastSkyUpdate===-Infinity){
        frame=sky.update(clock.time,camera,{resetExposure});skyTime=clock.time;lastSkyUpdate=now;resetExposure=false;
      }
      sky.advanceExposure(exposureElapsed);exposureElapsed=0;
      sky.faceCamera(camera);updateReadout();renderer.render(scene,camera);
      lastDraw=now;dirty=false;
    }
    if(motion||['approach','settling','departing','retreating'].includes(journey.phase)||(interactive&&clock.playing))schedule();
  }
  function schedule(){if(!raf&&!disposed&&!document.hidden)raf=requestAnimationFrame(render);}
  function invalidate(){dirty=true;schedule();}
  function aim(targetHeading,targetPitch) {
    const delta=THREE.MathUtils.euclideanModulo(targetHeading-heading+180,360)-180;
    const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:950;
    if(!duration){ heading=targetHeading;pitch=targetPitch;motion=null; }
    else motion={heading,pitch,delta,targetPitch,elapsed:0,duration};
    lastFrame=null;invalidate();
  }
  listen($('.surface-parent'),'click',()=>{const angles=horizonAngles(frame.targets[site.parent].direction);aim(angles.azimuth,angles.altitude);});
  listen($('.surface-reset'),'click',()=>aim(site.initialHeading,initialPitch()));
  listen(root,'keydown',event=>{
    if (journey.phase!=='landed'||!$('.surface-details').hidden||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    const moves={ArrowLeft:[-3,0],ArrowRight:[3,0],ArrowUp:[0,3],ArrowDown:[0,-3]};
    if (moves[event.key]) {event.preventDefault();motion=null;heading+=moves[event.key][0];pitch+=moves[event.key][1];invalidate();}
  });

  async function texture(url) {
    const result = await new THREE.TextureLoader().loadAsync(url);
    if(disposed){result.dispose();throw new Error('观景已关闭');}
    textures.add(result);result.colorSpace=THREE.SRGBColorSpace;
    result.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    return result;
  }
  async function load() {
    try {
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
      renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));renderer.setSize(innerWidth,innerHeight);
      renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
      const canvas=renderer.domElement;
      canvas.setAttribute('aria-label',`${site.name}固定观景点，拖动改变朝向`);canvas.tabIndex=0;
      $('.surface-canvas').append(canvas);
      const groundUrl=id==='moon'&&(innerWidth<=760||renderer.capabilities.maxTextureSize<8192)?'/surface/moon-4k.webp':site.texture;
      const pending=await Promise.allSettled([texture(groundUrl),texture(site.parentTexture),
        ...(id==='moon'?[texture('/solar-system/textures/2k_earth_clouds.jpg')]:[])]);
      if(disposed)return;
      for(const result of pending)if(result.status==='rejected')throw new Error('全景或天体纹理未能加载，请返回轨道后重试。');
      const [ground,parentMap,cloudMap]=pending.map(x=>x.value);
      ground.wrapS=THREE.RepeatWrapping;
      const dome=new THREE.Mesh(new THREE.SphereGeometry(100,128,64),new THREE.ShaderMaterial({
        uniforms:{panorama:{value:ground},center:{value:rad(site.panoramaCenter)},daylight:{value:1}},
        vertexShader:'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:`uniform sampler2D panorama;uniform float center;uniform float daylight;varying vec3 direction;
          void main(){vec3 d=normalize(direction);vec2 uv=vec2((atan(d.x,-d.z)-center)/6.28318530718+.5,.5+asin(clamp(d.y,-1.,1.))/3.14159265359);
          // Correct the longitude derivative across the wrap, avoiding a
          // full-texture mip sample that would draw a vertical seam in the sky.
          vec2 dx=dFdx(uv),dy=dFdy(uv);dx.x-=round(dx.x);dy.x-=round(dy.x);
          vec4 c=textureGrad(panorama,uv,dx,dy);if(c.a<.03)discard;
          c.rgb*=daylight*mix(vec3(.7,.79,1.),vec3(1.),smoothstep(.015,.25,daylight));gl_FragColor=c;
          #include <colorspace_fragment>
          }`,
        side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false,
      }));dome.renderOrder=20;scene.add(dome);
      sky=createSurfaceSky({scene,renderer,site,parentMap,cloudMap,groundMaterial:dome.material,signal:events.signal,
        onCatalogueReady:()=>{lastSkyUpdate=-Infinity;invalidate();},
        onCatalogueError:()=>{notice('完整星表暂未加载，已显示主要亮星。');invalidate();}});
      listen(canvas,'pointerdown',event=>{
        if(journey.phase!=='landed'||drag||!event.isPrimary||event.button!==0)return;
        motion=null;drag={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);canvas.focus();
      });
      listen(canvas,'pointermove',event=>{
        if(!drag||drag.id!==event.pointerId)return;
        heading-=(event.clientX-drag.x)*camera.fov/innerHeight;
        pitch+=(event.clientY-drag.y)*camera.fov/innerHeight;
        drag.x=event.clientX;drag.y=event.clientY;invalidate();
      });
      for(const eventName of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,eventName,event=>{if(drag?.id===event.pointerId)drag=null;});
      listen(canvas,'wheel',event=>event.preventDefault(),{passive:false});
      listen(canvas,'contextmenu',event=>event.preventDefault());
      listen(canvas,'webglcontextlost',event=>{
        event.preventDefault();loaded=false;clock.playing=false;
        journey.enter('error');invalidate();notice('观景画面已中断，请返回轨道重新进入。');
      });
      listen(window,'resize',()=>{
        if(!motion && Math.abs(heading-site.initialHeading)<.1 && Math.abs(pitch-resetPitch)<.1) pitch=initialPitch();
        resetPitch=initialPitch();
        camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);invalidate();
      });
      listen($('.surface-photo'),'click',()=>{
        if(!loaded||journey.phase!=='landed')return;
        updateCamera();frame=sky.update(clock.time,camera);renderer.render(scene,camera);
        const photo=document.createElement('canvas');photo.width=canvas.width;photo.height=canvas.height;
        const context=photo.getContext('2d');context.drawImage(canvas,0,0);
        const scale=photo.width/innerWidth;
        context.scale(scale,scale);context.fillStyle='rgba(0,0,0,.65)';context.fillRect(0,innerHeight-98,innerWidth,98);
        context.fillStyle='#eee';context.font='15px sans-serif';context.fillText(`星际图鉴 · ${site.name} / ${site.title}`,20,innerHeight-68,innerWidth-40);
        context.font='11px sans-serif';context.fillStyle='#b9bac0';context.fillText(`${site.provenance} · ${new Date(clock.time).toISOString().replace('T',' ').slice(0,19)} UTC`,20,innerHeight-43,innerWidth-40);
        context.fillText(site.credit,20,innerHeight-22,innerWidth-40);
        photo.toBlob(blob=>{
          if(disposed)return;
          if(!blob){notice('照片生成失败，请再试一次。');return;}
          const url=URL.createObjectURL(blob),link=document.createElement('a');
          link.href=url;link.download=`space-atlas-${id}.png`;link.click();
          setTimeout(()=>URL.revokeObjectURL(url),1000);
          notice('照片已生成，已开始下载。');
        },'image/png');
      });
      loaded=true;journey.ready();lastFrame=null;invalidate();
    } catch(error) {
      if(disposed)return;
      journey.fail();invalidate();
      $('.surface-message').hidden=false;
      $('.surface-message').textContent=error.message || '观景暂时无法打开，请返回轨道重试。';
    }
  }
  updateReadout();invalidate();
  load();
  return { dispose, getTime:()=>clock.time };
}
