// Regenerates the two screenshots this review references and re-checks its defects 2 and 3 against
// the current layout. Run with the dev server up:
//   npx vite --host 127.0.0.1 --port 5311 --strictPort
//   ATLAS_URL=http://127.0.0.1:5311 node outputs/saturn-review-20260913/verify-framing.mjs
//
// Defect 2 (desktop 1280x720): a ~255x215 px control panel covered the right end of the rings.
// Defect 3 (phone 390x844): "动态活动" was squeezed into one character per line and the toolbar
// covered the ring's right side, extending over the card below.
//
// Method. Whether UI covers the rings is a pixel question, not a geometry question, so two reads of
// the same page state are compared, both cropped to the canvas:
//   scene     overlays hidden with visibility (which cannot reflow) = what the renderer drew
//   composite UI as shipped                                            = what the visitor sees
// A pixel is *dimmed* when it is bright in the scene and still above VISIBLE_FLOOR in the
// composite, and *hidden* when the composite drops it below that floor. Only the second is a
// defect: the bottom bar's top edge is a 61%-alpha gradient, so content behind it stays legible on
// purpose. Each hidden pixel is attributed with elementFromPoint in the normal page state, so the
// report names what hides it instead of guessing. The body silhouette is the largest bright
// connected component, so stray bright specks elsewhere cannot move the reference. A planted panel
// of the size the review measured, placed where the old panel sat, proves the metric has teeth.
//
// desktop.png and mobile.png belong to the 2026-09-13 record. This script writes dated copies
// (desktop-20260916.png, mobile-20260916.png) and must never overwrite those two.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync,writeFileSync} from 'node:fs';
const out='outputs/saturn-review-20260913',base=process.env.ATLAS_URL||'http://127.0.0.1:5191';
await mkdir(out,{recursive:true});
const BRIGHT=90;                       // ring peak measured 251 against sky 43; stars stay below this
const VISIBLE_FLOOR=25;                // below this a pixel does not read as visible any more
const HIDDEN_ALLOWANCE=64;             // max scene pixels one fixed element may hide (the 2026-09-13 panel hid ~12,700)
const PANEL={w:255,h:215};             // the size the 2026-09-13 review measured for the panel
const CASES=[['desktop',1280,720,1],['phone',390,844,3]];

const readBright=async(page,viewport,{mode,panel=null,save=null})=>{
  await page.evaluate(({mode,panel})=>{
    const canvas=document.querySelector('canvas'),old=document.getElementById('planted-panel');
    if(old)old.remove();
    const keep=el=>el===canvas||el.contains(canvas)||el.tagName==='CANVAS';
    for(const el of document.querySelectorAll('body *')){
      el.style.visibility=mode==='composite'?'':keep(el)?'':'hidden';}
    if(mode==='planted'&&panel){const d=document.createElement('div');d.id='planted-panel';
      d.style.cssText=`position:fixed;left:${panel.x}px;top:${panel.y}px;width:${panel.w}px;height:${panel.h}px;background:#111;z-index:99`;
      document.body.appendChild(d);}
  },{mode,panel});
  await page.waitForTimeout(200);
  const shot=await page.locator('canvas').first().screenshot({path:save||undefined});
  const png=PNG.sync.read(shot),sx=png.width/viewport.w,sy=png.height/viewport.h,luma=new Uint8Array(viewport.w*viewport.h);
  for(let y=0;y<viewport.h;y++)for(let x=0;x<viewport.w;x++){
    luma[y*viewport.w+x]=png.data[(Math.min(png.height-1,Math.floor(y*sy))*png.width+Math.min(png.width-1,Math.floor(x*sx)))*4];}
  return luma;
};
const maskAt=(luma,viewport,min)=>new Set([...luma.keys()].filter(i=>luma[i]>=min)
  .map(i=>`${i%viewport.w},${Math.floor(i/viewport.w)}`));
const largestComponent=pixels=>{
  const set=new Set(pixels.map(([x,y])=>`${x},${y}`)),seen=new Set();let best=[];
  for(const key of set){if(seen.has(key))continue;
    const queue=[key],comp=[];seen.add(key);
    while(queue.length){const k=queue.pop();comp.push(k);const [x,y]=k.split(',').map(Number);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const n=`${x+dx},${y+dy}`;if(set.has(n)&&!seen.has(n)){seen.add(n);queue.push(n);}}}
    if(comp.length>best.length)best=comp;}
  return best.map(k=>k.split(',').map(Number));
};
const inRect=([x,y],r)=>x>=r.x&&x<r.x+r.w&&y>=r.y&&y<r.y+r.h;
// magnified pair of crops around whatever the chrome did cover, so the residual claim is checkable
// by eye rather than only as a pixel count
const cropPair=(sceneFile,compositeFile,region,scale,dst)=>{
  for(const [src,suffix] of [[sceneFile,'scene'],[compositeFile,'composite']]){
    const png=PNG.sync.read(readFileSync(src)),out=new PNG({width:region.w*scale,height:region.h*scale});
    for(let y=0;y<region.h*scale;y++)for(let x=0;x<region.w*scale;x++){
      const sx=Math.min(png.width-1,region.x+Math.floor(x/scale)),sy=Math.min(png.height-1,region.y+Math.floor(y/scale));
      const si=(sy*png.width+sx)*4,di=(y*out.width+x)*4;
      for(let k=0;k<4;k++)out.data[di+k]=png.data[si+k];}
    writeFileSync(dst.replace('%s',suffix),PNG.sync.write(out));}
};

const browser=await chromium.launch({channel:'msedge',headless:true});
const report=[];let page,name;
try{
for(const [caseName,width,height,dpr] of CASES){
  name=caseName;
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr,reducedMotion:'reduce'});
  await context.addInitScript(()=>sessionStorage.setItem('space-atlas:scene:solar-system',JSON.stringify({version:1,value:{date:Date.UTC(2026,8,16),playing:false,selected:null,speed:1000,speedUnit:'realtime'}})));
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/solar-system/');
  const settle=()=>page.waitForFunction(()=>{const s=window.solarAtlas?.snapshot();return s?.ready&&!s.flight&&!s.ephemeris.blocked;},null,{timeout:60000});
  await settle();
  await page.locator('#atlas-tab').click();
  await page.locator('#atlas-search').fill('saturn');
  await page.locator('.atlas-item[data-body="saturn"]').click();
  await settle();await page.waitForTimeout(1500);

  // layout facts, read while the page is untouched
  const ui=await page.evaluate(()=>{
    const painted=el=>{const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return false;
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===el||el.contains(hit));};
    const describe=el=>el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+(typeof el.className==='string'?el.className.trim().split(/\s+/)[0]:'');
    const controls=[];
    for(const el of document.querySelectorAll('button, summary, a')){
      if(!painted(el))continue;
      const r=el.getBoundingClientRect(),span=el.querySelector('span')||el;
      let lines=0;
      if(span.firstChild?.nodeType===3){const rg=document.createRange();rg.selectNodeContents(span);
        lines=[...rg.getClientRects()].filter(q=>q.height>1).length;}
      controls.push({sel:describe(el),x:+r.x.toFixed(2),y:+r.y.toFixed(2),w:+r.width.toFixed(2),h:+r.height.toFixed(2),
        text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,30),lines,
        sceneAnchored:!!el.closest('#landmark-markers, #planet-labels')});}
    return {controls,docOverflowX:document.documentElement.scrollWidth-innerWidth,viewport:{w:innerWidth,h:innerHeight}};
  });
  await page.screenshot({path:`${out}/${caseName}-20260916.png`});   // evidence; desktop.png/mobile.png are the 2026-09-13 record and must not be written

  const composite=await readBright(page,ui.viewport,{mode:'composite',save:`${out}/${caseName}-composite-canvas.png`});
  const scene=await readBright(page,ui.viewport,{mode:'scene',save:`${out}/${caseName}-scene-canvas.png`});
  // the primary mask, plus two sensitivity levels: the ring's outer arm is dimmer than its bright side,
  // so a single threshold could hide exactly the covered region by calling it background
  const THRESHOLDS=[60,90,140];
  const sceneMasks=Object.fromEntries(THRESHOLDS.map(t=>[t,maskAt(scene,ui.viewport,t)]));
  const compositeMasks=Object.fromEntries(THRESHOLDS.map(t=>[t,maskAt(composite,ui.viewport,t)]));
  const silhouette=largestComponent([...sceneMasks[BRIGHT]].map(k=>k.split(',').map(Number)));
  const tipX=Math.max(...silhouette.map(([x])=>x)),tipY=Math.max(...silhouette.map(([,y])=>y));
  const bbox={x0:Math.min(...silhouette.map(([x])=>x)),y0:Math.min(...silhouette.map(([,y])=>y)),
    x1:tipX,y1:Math.max(...silhouette.map(([,y])=>y))};
  const midY=Math.round(silhouette.reduce((s,[,y])=>s+y,0)/silhouette.length);
  const probe={x:Math.max(0,tipX-100),y:Math.max(0,Math.min(ui.viewport.h-PANEL.h,midY-Math.round(PANEL.h/2))),...PANEL};
  const planted=await readBright(page,ui.viewport,{mode:'planted',panel:probe});
  await page.evaluate(()=>{const p=document.getElementById('planted-panel');if(p)p.remove();
    for(const el of document.querySelectorAll('body *'))el.style.visibility='';});
  const plantedMasks=Object.fromEntries(THRESHOLDS.map(t=>[t,maskAt(planted,ui.viewport,t)]));

  // Attribution also partitions the body silhouette: a scene-anchored marker is *content* and is meant
  // to sit on the body, while fixed chrome covering it is the defect this check exists for. Labels are
  // drawn with pointer-events:none, so elementFromPoint answers the canvas underneath them; those
  // pixels are folded back onto content by testing them against the anchored markers' rectangles.
  const attributionFor=async(lost,threshold,silhouettePoints)=>lost.length?await page.evaluate(({coords,threshold,silhouette})=>{
    const describe=el=>el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+(typeof el.className==='string'?el.className.trim().split(/\s+/)[0]:'');
    const inBody=new Set(silhouette.map(([x,y])=>`${x},${y}`));
    const anchored=[...document.querySelectorAll('#landmark-markers *, #planet-labels *')]
      .filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect());
    const coveredByAnchor=(x,y)=>anchored.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);
    const by=new Map();const counts={byChrome:0,byContent:0,inBodyByChrome:0,inBodyByContent:0};
    for(const [x,y] of coords){const el=document.elementFromPoint(x,y);if(!el)continue;
      const ownAnchored=!!el.closest('#landmark-markers, #planet-labels');
      const sceneAnchored=ownAnchored||(el.tagName==='CANVAS'&&coveredByAnchor(x,y));
      // Most pixels of a detached element are unattributable, but the ones over a marker's label are
      // not chrome either; the group is named for what actually owns the point.
      const owner=sceneAnchored?'content':describe(el);
      const key=owner+'|'+(sceneAnchored?'scene-anchored marker':el.id?'':(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,20));
      const r=el.getBoundingClientRect();
      const e=by.get(key)||{sel:owner,text:key.split('|')[1],pixels:0,threshold,sceneAnchored,
        rect:{x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},area:[Infinity,Infinity,-Infinity,-Infinity]};
      e.pixels++;e.area=[Math.min(e.area[0],x),Math.min(e.area[1],y),Math.max(e.area[2],x),Math.max(e.area[3],y)];by.set(key,e);
      if(sceneAnchored){counts.byContent++;if(inBody.has(`${x},${y}`))counts.inBodyByContent++;}
      else{counts.byChrome++;if(inBody.has(`${x},${y}`))counts.inBodyByChrome++;}}
    return {groups:[...by.values()].map(e=>({...e,area:{x0:e.area[0],y0:e.area[1],x1:e.area[2],y1:e.area[3]}})).sort((a,b)=>b.pixels-a.pixels),counts};
  },{coords:lost,threshold,silhouette:silhouettePoints}):{groups:[],counts:{byChrome:0,byContent:0,inBodyByChrome:0,inBodyByContent:0}};
  const perThreshold={};
  const lumaAt=(arr,[x,y])=>arr[y*ui.viewport.w+x];
  for(const t of THRESHOLDS){
    const lost=[...sceneMasks[t]].filter(k=>!compositeMasks[t].has(k)).map(k=>k.split(',').map(Number));
    // "bright in the scene, below the bright threshold in the composite" has two very different
    // causes, and only one of them is a defect: content that is still legible behind a feathered
    // edge is dimmed, content behind an opaque panel is hidden. The split is by the composite
    // luminance of the pixel, against a floor below which nothing reads as visible.
    const hidden=lost.filter(p=>lumaAt(composite,p)<VISIBLE_FLOOR);
    const dimmed=lost.filter(p=>lumaAt(composite,p)>=VISIBLE_FLOOR);
    const {groups,counts}=await attributionFor(hidden,t,silhouette);
    const chromeHidden=groups.filter(a=>!a.sceneAnchored);
    const ratios=dimmed.map(p=>+(lumaAt(composite,p)/(lumaAt(scene,p)||1)).toFixed(3));
    perThreshold[t]={sceneBrightPixels:sceneMasks[t].size,dimmedPixels:dimmed.length,
      dimmingRatioRange:ratios.length?[Math.min(...ratios),Math.max(...ratios)]:null,
      dimmedCoords:dimmed,hiddenCoords:hidden,
      hiddenPixels:hidden.length,hiddenByChrome:chromeHidden,
      hiddenBySceneAnchoredContent:groups.filter(a=>a.sceneAnchored),
      hiddenInsideBodySilhouette:counts.inBodyByChrome,
      contentInsideBodySilhouette:counts.inBodyByContent,
      maxHiddenByOneChromeElement:chromeHidden.reduce((m,a)=>Math.max(m,a.pixels),0)};
  }
  const primary=perThreshold[BRIGHT];
  // clearance from the ring's right tip to the nearest fixed UI: rectangle-to-point distance, so a
  // control that merely shares a column with the tip does not read as nearby
  const tipGap=c=>{const dx=Math.max(0,c.x-tipX,tipX-(c.x+c.w)),dy=Math.max(0,c.y-tipY,tipY-(c.y+c.h));return +Math.hypot(dx,dy).toFixed(1);};
  const nearChrome=ui.controls.filter(c=>!c.sceneAnchored).map(c=>({...c,gap:tipGap(c)})).sort((a,b)=>a.gap-b.gap)[0]||null;
  const selfTestLost=[...sceneMasks[BRIGHT]].filter(k=>{const [x,y]=k.split(',').map(Number);
    return inRect([x,y],probe)&&!plantedMasks[BRIGHT].has(k);}).length;
  const selfTestHidden=[...sceneMasks[BRIGHT]].filter(k=>{const [x,y]=k.split(',').map(Number);
    return inRect([x,y],probe)&&lumaAt(planted,[x,y])<VISIBLE_FLOOR;}).length;
  // motion floor: the scene read twice with no UI involved. A body rotating between two reads makes a
  // few bright pixels appear to darken, and that is not coverage; the chrome figures have to beat it.
  const sceneAgain=await readBright(page,ui.viewport,{mode:'scene'});
  const sceneAgainMask=maskAt(sceneAgain,ui.viewport,BRIGHT);
  const motionBaseline=[...sceneMasks[BRIGHT]].filter(k=>!sceneAgainMask.has(k)).length;
  const verticalText=ui.controls.filter(c=>c.lines>=3);
  const outside=ui.controls.filter(c=>c.x<-.1||c.y<-.1||c.x+c.w>ui.viewport.w+.1||c.y+c.h>ui.viewport.h+.1);

  const row={case:caseName,viewport:`${width}x${height}@${dpr}`,base,date:'2026-09-16',
    primaryThreshold:BRIGHT,silhouettePixels:silhouette.length,silhouetteBBox:bbox,ringRightTipCss:{x:tipX,y:tipY},
    nearestChromeToRingTip:nearChrome?{sel:nearChrome.sel,gap:nearChrome.gap,rect:{x:nearChrome.x,y:nearChrome.y,w:nearChrome.w,h:nearChrome.h}}:null,
    controlsChecked:ui.controls.length,
    sceneBrightPixels:primary.sceneBrightPixels,
    dimmedByChromePixels:primary.dimmedPixels,dimmingRatioRange:primary.dimmingRatioRange,
    hiddenByUiPixels:primary.hiddenPixels,
    hiddenByChrome:primary.hiddenByChrome,hiddenBySceneAnchoredContent:primary.hiddenBySceneAnchoredContent,
    hiddenInsideBodySilhouette:primary.hiddenInsideBodySilhouette,
    maxHiddenByOneChromeElement:primary.maxHiddenByOneChromeElement,
    hiddenAllowancePixels:HIDDEN_ALLOWANCE,
    motionBaselinePixels:motionBaseline,
    sensitivity:Object.fromEntries(THRESHOLDS.map(t=>[t,{sceneBrightPixels:perThreshold[t].sceneBrightPixels,
      dimmedPixels:perThreshold[t].dimmedPixels,dimmingRatioRange:perThreshold[t].dimmingRatioRange,
      hiddenPixels:perThreshold[t].hiddenPixels,
      hiddenInsideBodySilhouette:perThreshold[t].hiddenInsideBodySilhouette,
      maxHiddenByOneChromeElement:perThreshold[t].maxHiddenByOneChromeElement,
      hiddenByChrome:perThreshold[t].hiddenByChrome.map(a=>({sel:a.sel,pixels:a.pixels}))}])),
    selfTest:{plantedRect:probe,sceneBrightInsidePlantedRect:[...sceneMasks[BRIGHT]].filter(k=>{const [x,y]=k.split(',').map(Number);return inRect([x,y],probe);}).length,
      dimmedByPlantedPanel:selfTestLost,hiddenByPlantedPanel:selfTestHidden,detected:selfTestHidden>0},
    verticalText:verticalText.map(c=>({sel:c.sel,lines:c.lines,text:c.text})),
    outsideViewport:outside.map(c=>c.sel),docOverflowX:ui.docOverflowX,errors};
  report.push(row);
  const cropAround=(pixels,suffix,scale)=>{
    if(!pixels.length)return;
    const a={x0:Math.min(...pixels.map(p=>p[0]))-20,y0:Math.min(...pixels.map(p=>p[1]))-16,
      x1:Math.max(...pixels.map(p=>p[0]))+20,y1:Math.max(...pixels.map(p=>p[1]))+16};
    cropPair(`${out}/${caseName}-scene-canvas.png`,`${out}/${caseName}-composite-canvas.png`,
      {x:Math.max(0,a.x0),y:Math.max(0,a.y0),w:Math.min(ui.viewport.w,a.x1)-Math.max(0,a.x0),h:Math.min(ui.viewport.h,a.y1)-Math.max(0,a.y0)},
      scale,`${out}/${caseName}-${suffix}-%s.png`);
  };
  const hiddenPixels=[];
  cropAround(primary.dimmedCoords,'dimmed',caseName==='phone'?1:2);
  cropAround(primary.hiddenCoords,'hidden',caseName==='phone'?1:2);
  console.log(caseName,JSON.stringify({silhouette:silhouette.length,bbox,ringRightTip:{x:tipX,y:tipY},
    nearestChrome:row.nearestChromeToRingTip,
    byThreshold:Object.fromEntries(THRESHOLDS.map(t=>[t,{bright:perThreshold[t].sceneBrightPixels,
      dimmed:perThreshold[t].dimmedPixels+' at ratio '+(perThreshold[t].dimmingRatioRange?.join('-')??'-'),
      hidden:perThreshold[t].hiddenPixels+' (silhouette '+perThreshold[t].hiddenInsideBodySilhouette+')',
      chrome:perThreshold[t].hiddenByChrome.map(a=>a.sel+':'+a.pixels+' rect='+JSON.stringify(a.rect)+' area='+JSON.stringify(a.area))}])),
    content:primary.hiddenBySceneAnchoredContent.map(a=>a.sel+':'+a.pixels),
    selfTest:row.selfTest,motionBaselinePixels:motionBaseline,
    verticalText:verticalText.map(c=>c.sel+':'+c.lines),outside:outside.map(c=>c.sel),
    docOverflowX:ui.docOverflowX,errors}));
  // The assertion this whole check exists for: fixed UI may dim passing scene content at a feathered
  // edge, but it must not hide the selected body, and no single element may hide more than the
  // allowance. Checked at every threshold, since one level alone could pass while another fails.
  // The 2026-09-13 panel hid ~12,700 px of the body; the allowance is two orders below it.
  for(const t of THRESHOLDS){
    const level=perThreshold[t];
    assert.equal(level.hiddenInsideBodySilhouette,0,
      `${caseName} @${t}: fixed UI covers the selected body`);
    assert.ok(level.maxHiddenByOneChromeElement<=HIDDEN_ALLOWANCE,
      `${caseName} @${t}: ${level.hiddenByChrome.map(a=>a.sel+':'+a.pixels).join(', ')||'none'} exceeds ${HIDDEN_ALLOWANCE} px`);
  }
  assert.ok(selfTestHidden>=300,`${caseName}: the hidden-content metric cannot see a planted 255x215 panel (${selfTestHidden} px)`);
  console.log(`${caseName}: assertions passed (body silhouette hidden 0 px at ${THRESHOLDS.join('/')}, worst single element ${Math.max(...THRESHOLDS.map(t=>perThreshold[t].maxHiddenByOneChromeElement))} <= ${HIDDEN_ALLOWANCE}, planted panel ${selfTestHidden} px)`);
  await context.close();
}
await writeFile(`${out}/framing-report.json`,JSON.stringify(report,null,2));
}catch(error){
  if(page&&!page.isClosed()){await page.screenshot({path:`${out}/failure-${name}.png`});
    await writeFile(`${out}/framing-failure.json`,JSON.stringify({name,error:error.stack},null,2));}
  throw error;
}finally{await browser.close();}
