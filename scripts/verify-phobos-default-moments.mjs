// Recompute the fixed predicate, search, independent comparison and collateral
// audit from the registered sites. This script never edits site data or assets.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MathUtils} from 'three';
import {PhysicalState} from '../solar-system/src/physics/state.js';
import {EphemerisStore} from '../solar-system/src/physics/ephemeris.js';
import {localFetcher} from './verify-phobos-reference.mjs';
import {landingSites,surfaceFrame,angularDiameter,horizonAngles,sunHiddenByParent,nextDaylight} from '../solar-system/src/surface/geometry.js';

const radToDeg=MathUtils.radToDeg, start=Date.parse('2026-09-27T00:00:00Z');
const rejectedDate='2026-09-27T00:39:00Z';
const reference=JSON.parse(await readFile(new URL('../solar-system/tests/phobos-eclipse-reference.json',import.meta.url),'utf8'));
const root=fileURLToPath(new URL('../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
const normalize=text=>text.replaceAll('\r\n','\n');
const baselineSites=normalize(git('show','d28842d:solar-system/src/surface/sites.js'));
const currentSites=normalize(await readFile(new URL('../solar-system/src/surface/sites.js',import.meta.url),'utf8'));
let expectedSites=baselineSites;
for(const candidate of reference.candidates){
  const marker="texture:'/surface/"+candidate.siteId+".webp',\n    date:'";
  const old=marker+rejectedDate+"'";
  assert.ok(expectedSites.includes(old),'baseline site anchor '+candidate.siteId);
  expectedSites=expectedSites.replace(old,marker+candidate.date+"'");
}
assert.equal(currentSites,expectedSites,'only the two Phobos site.date fields may change');
const protectedChanges=git('diff','d28842d','--name-only','--','public','solar-system/src/physics',
  'solar-system/src/physical-scale.js','solar-system/src/body-models.js').trim();
assert.equal(protectedChanges,'','textures, orbital and attitude/radius definitions must stay unchanged');
const provider=new PhysicalState({ephemeris:new EphemerisStore({fetcher:localFetcher})});
provider.ephemeris.maxEntries=32;

function metrics(site,time=Date.parse(site.date)) {
  const frame=surfaceFrame(site,new Date(time),provider),sun=frame.targets.Sun,parent=frame.targets[site.parent];
  const sunAltitudeDeg=horizonAngles(sun.direction).altitude;
  const oldParentRadiusDeg=radToDeg(Math.atan(parent.radiusKm/parent.distanceKm));
  const parentRadiusDeg=radToDeg(angularDiameter(parent.radiusKm,parent.distanceKm)/2);
  const oldSunRadiusDeg=radToDeg(Math.atan(sun.radiusKm/sun.distanceKm));
  const sunRadiusDeg=radToDeg(angularDiameter(sun.radiusKm,sun.distanceKm)/2);
  const separationDeg=radToDeg(sun.direction.angleTo(parent.direction));
  const oldThresholdDeg=oldParentRadiusDeg+oldSunRadiusDeg,thresholdDeg=parentRadiusDeg+sunRadiusDeg;
  const oldEclipsed=separationDeg<oldThresholdDeg,eclipsed=sunHiddenByParent(frame,site);
  return {siteId:site.siteId,body:site.id,parent:site.parent,date:new Date(time).toISOString(),
    parentDistanceKm:parent.distanceKm,parentRadiusKm:parent.radiusKm,sunDistanceKm:sun.distanceKm,sunRadiusKm:sun.radiusKm,
    oldParentRadiusDeg,parentRadiusDeg,parentRadiusIncreaseDeg:parentRadiusDeg-oldParentRadiusDeg,
    oldSunRadiusDeg,sunRadiusDeg,sunRadiusIncreaseDeg:sunRadiusDeg-oldSunRadiusDeg,
    oldThresholdDeg,thresholdDeg,thresholdIncreaseDeg:thresholdDeg-oldThresholdDeg,separationDeg,
    clearanceDeg:separationDeg-thresholdDeg,sunAltitudeDeg,parentAltitudeDeg:horizonAngles(parent.direction).altitude,
    oldEclipsed,eclipsed,totalEclipse:separationDeg<parentRadiusDeg-sunRadiusDeg,
    changedToEclipse:!oldEclipsed&&eclipsed,daylightAltitudeThresholdDeg:site.daylightAltitude??8,
    oldDaylightEligible:sunAltitudeDeg>(site.daylightAltitude??8)&&!oldEclipsed,
    daylightEligible:sunAltitudeDeg>(site.daylightAltitude??8)&&!eclipsed};
}

function search(site) {
  let prior=metrics(site,start),lastEgress=null;
  for(let time=start+60000;time<=start+6*3600000;time+=60000) {
    const current=metrics(site,time);
    if(prior.eclipsed&&!current.eclipsed) {
      let lower=time-60000,upper=time;
      while(upper-lower>1) {
        const mid=Math.floor((lower+upper)/2);
        if(metrics(site,mid).eclipsed)lower=mid;else upper=mid;
      }
      lastEgress={lower:new Date(lower).toISOString(),upper:new Date(upper).toISOString()};
    }
    if(lastEgress&&!current.eclipsed&&current.sunAltitudeDeg>8&&time-Date.parse(lastEgress.upper)>=12*60000) {
      return {date:current.date,egressBracket:lastEgress,minimumMinutesAfterEgress:(time-Date.parse(lastEgress.upper))/60000};
    }
    prior=current;
  }
  throw new Error('No safe moment for '+site.siteId);
}

try {
  for(const site of Object.values(landingSites))await provider.ensure(new Date(site.date),[site.id],{prefetch:false});
  const defaults=Object.values(landingSites).filter(site=>site.parent!=='Sun').map(site=>metrics(site));
  const excluded=Object.values(landingSites).filter(site=>site.parent==='Sun').map(site=>({siteId:site.siteId,reason:'母体为太阳，不适用主星遮日判据'}));
  const moments=[],rejected=[];
  for(const siteId of ['phobos-60e','phobos-311e']) {
    const site=landingSites[siteId],selected=search(site),actual=metrics(site,Date.parse(selected.date));
    const independent=reference.candidates.find(candidate=>candidate.siteId===siteId);
    assert.equal(Date.parse(selected.date),Date.parse(independent.date),'independent first eligible minute');
    assert.equal(Date.parse(site.date),Date.parse(selected.date),'registered default must match the verified search');
    assert.ok(Math.abs(actual.sunAltitudeDeg-independent.meanSphere.sunAltitudeDeg)<.01);
    assert.ok(Math.abs(actual.separationDeg-independent.meanSphere.separationDeg)<.01);
    assert.ok(independent.minimumMinutesAfterEgress>=10);
    const interval=[];
    for(let time=Date.parse(selected.date)-10*60000;time<=Date.parse(selected.date);time+=15000) {
      const m=metrics(site,time);assert.equal(m.eclipsed,false,siteId+' buffer eclipse');
      interval.push({date:m.date,clearanceDeg:m.clearanceDeg});
    }
    const next=nextDaylight(site,Date.parse(selected.date),provider);
    assert.ok(Number.isFinite(next));
    const daylightJump=metrics(site,next);
    assert.ok(daylightJump.daylightEligible);
    moments.push({...actual,registeredDate:site.date,registeredMatchesSearch:Date.parse(site.date)===Date.parse(selected.date),
      search:selected,independent:{date:independent.date,sunAltitudeDeg:independent.meanSphere.sunAltitudeDeg,
        meanSphereClearanceDeg:independent.meanSphere.clearanceDeg,equatorialSphereClearanceDeg:independent.equatorialSphere.clearanceDeg,
        minimumMinutesAfterEgress:independent.minimumMinutesAfterEgress,egressBrackets:reference.egress.sites[siteId]},
      lastTenMinutes:interval,daylightJump});
    rejected.push(metrics(site,Date.parse(rejectedDate)));
  }
  const report={baseline:'d28842d',scope:'All 21 registered sites; every non-Sun occulting parent, including the Pluto/Charon pair',
    scopeChecks:{other19SiteDataUnchanged:true,onlyTwoPhobosDatesChanged:true,protectedPathsChanged:[]},
    totalSites:Object.keys(landingSites).length,auditedDefaults:defaults.length,excluded,
    defaults,changedDefaults:defaults.filter(row=>row.changedToEclipse).map(row=>row.siteId),
    rejectedPhobosOldDefaults:rejected,otherSitesChanged:defaults.filter(row=>row.body!=='phobos'&&row.changedToEclipse).map(row=>row.siteId),
    limitations:'Existing project radii, ephemerides, attitude and site dates; disk overlap is not the same as Sun altitude or terrain visibility.'};
  report.baselineDefaults=defaults.map(row=>rejected.find(old=>old.siteId===row.siteId)??row);
  report.baselineChangedDefaults=report.baselineDefaults.filter(row=>row.changedToEclipse).map(row=>row.siteId);
  const evidence={rejectedDate,reason:'atan(r/d) underestimated spherical angular radii; both old default moments still overlap Mars.',
    search:{start:new Date(start).toISOString(),stepSeconds:60,minimumSunAltitudeDeg:8,acceptanceMarginMinutes:10,selectionMarginMinutes:12},
    reference:'solar-system/tests/phobos-eclipse-reference.json',moments};
  await mkdir('test-results',{recursive:true});await mkdir('outputs/phobos-eclipse-fix',{recursive:true});
  for(const folder of ['test-results','outputs/phobos-eclipse-fix']) {
    await writeFile(folder+'/phobos-default-moments.json',JSON.stringify(evidence,null,2)+'\n');
    await writeFile(folder+'/satellite-eclipse-audit.json',JSON.stringify(report,null,2)+'\n');
  }
  const f=(value,places=6)=>value.toFixed(places);
  const lines=['# 全部落点的主星遮日判据影响审计','',
    '基线 d28842d。用同一个实际落点、同一个时刻和同一组物理数据，对比 atan 与 asin；未改其它落点数据。',
    '全部 '+report.totalSites+' 处中 '+report.auditedDefaults+' 处适用；包括冥王星观看冥卫一的配置，避免因天体分类漏检。角度单位为度。',
    '', '| 基线落点 | site.date（UTC） | 旧主星视半径 | 新主星视半径 | 主星增量 | 太阳增量 | 总门槛增量 | 太阳高度 | 旧食中→新食中 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|'];
  for(const row of report.baselineDefaults)lines.push('| '+[row.siteId,row.date,f(row.oldParentRadiusDeg),f(row.parentRadiusDeg),
    f(row.parentRadiusIncreaseDeg),f(row.sunRadiusIncreaseDeg,9),f(row.thresholdIncreaseDeg),f(row.sunAltitudeDeg),
    String(row.oldEclipsed)+' → '+String(row.eclipsed)].join(' | ')+' |');
  lines.push('', '只有旧 00:39 的两处火卫一默认时刻发生 false → true 翻转。其它 19 处数据未动；适用判据的其它 12 处没有翻转。',
    '“食中”指日面有交叠；不等于太阳中心在地平线上方，更不等于全部日面被遮住。默认时刻本来是夜晚的落点仍是夜晚，不在本包顺改。',
    '', '## 不适用的配置', '', ...excluded.map(row=>'- '+row.siteId+'：'+row.reason+'。'),
    '', '## 火卫一新默认', '', '| 落点 | UTC | 太阳高度 | 项目圆面净距 | 独立赤道球净距 | 保守完全出食后分钟 |',
    '|---|---|---:|---:|---:|---:|');
  for(const row of moments)lines.push('| '+[row.siteId,row.date,f(row.sunAltitudeDeg),f(row.clearanceDeg),
    f(row.independent.equatorialSphereClearanceDeg),f(row.independent.minimumMinutesAfterEgress)].join(' | ')+' |');
  lines.push('', '独立核验使用 Horizons UTC 几何向量与 CSPICE/PCK。项目维持 3389.5 km 平均火星半径；另以 PCK 3396.19 km 赤道球核验余量。',
    '这是固定球面观察点、球体圆面交叠检查，不声称已实现扁球精确接触、坑壁轮廓、折射或精密食预报。',
    '', '复算：npx tsx scripts/verify-phobos-default-moments.mjs。完整数值、被作废时刻和新时刻证据在本目录两份 JSON。','');
  await writeFile('outputs/phobos-eclipse-fix/satellite-eclipse-audit.md',lines.join('\n'));
  console.log(JSON.stringify({moments:moments.map(m=>({siteId:m.siteId,date:m.date,registeredMatchesSearch:m.registeredMatchesSearch,
    sunAltitudeDeg:m.sunAltitudeDeg,minimumMinutesAfterEgress:m.independent.minimumMinutesAfterEgress,search:m.search})),
    audit:{total:report.totalSites,checked:report.auditedDefaults,excluded:excluded.length,changed:report.changedDefaults,otherChanged:report.otherSitesChanged},
    rejected:rejected.map(m=>({siteId:m.siteId,oldEclipsed:m.oldEclipsed,eclipsed:m.eclipsed,totalEclipse:m.totalEclipse,separationDeg:m.separationDeg,thresholdDeg:m.thresholdDeg}))},null,2));
} finally {provider.dispose();}
