import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Vector3, MeshStandardMaterial, Texture, ShaderLib, NearestFilter } from 'three';
import { PNG } from 'pngjs';
import { analyticMirrorNormal, numericMirrorNormal, mirrorStrength, normalToLatLon, geographicNormal, latLonToUv, bindTitanGlint } from '../src/titan-glint.js';

test('finite mirror response peaks at reflection and is exactly zero on land, night, or outside cone', () => {
  const s=new Vector3(0,1,0),v=new Vector3(1,1,0).normalize(),n=analyticMirrorNormal(s,v);
  assert.equal(mirrorStrength(s,n,v),1);
  const perturbed=n.clone().applyAxisAngle(new Vector3(0,0,1),Math.PI/360);
  assert.ok(mirrorStrength(s,perturbed,v)>0 && mirrorStrength(s,perturbed,v)<1);
  assert.equal(mirrorStrength(s,n.clone().applyAxisAngle(new Vector3(0,0,1),.1),v),0);
  assert.equal(mirrorStrength(s,n,v,0),0);
  assert.equal(mirrorStrength(s,n.clone().negate(),v),0);
});

test('reflection search independently agrees with bisector in both hemispheres',()=>{
  for (const [s,v] of [[[.31,.88,-.22],[-.62,.53,.58]],[[.4,-.9,.1],[-.2,-.7,.5]],[[0,1,0],[1,.01,.1]]]) {
    const sun=new Vector3(...s),view=new Vector3(...v),a=analyticMirrorNormal(sun,view),b=numericMirrorNormal(sun,view);
    assert.ok(a.angleTo(b)<1e-6);
  }
});

test('mask samples measured sea interiors with IAU east-positive coordinates', async()=>{
  const mask=PNG.sync.read(await readFile(new URL('../../public/surface/titan-north-lakes-mask.png',import.meta.url)));
  assert.equal(mask.width,1024);assert.equal(mask.height,512);
  const sample=(lat,lon)=>{const [u,v]=latLonToUv(lat,lon);return mask.data[(Math.floor((1-v)*512)*1024+Math.floor(u*1024))*4];};
  assert.equal(sample(72.94921875,25.83984375),255);
  assert.equal(sample(0,25),0);assert.equal(sample(73,180),0);
  let liquid=0;for(let y=0;y<512;y++)for(let x=0;x<1024;x++){const p=mask.data[(y*1024+x)*4];assert.ok(p===0||p===255);if(p){liquid++;assert.ok(y<114);}}
  assert.equal(liquid,496);
  const point=normalToLatLon(geographicNormal(73,25));assert.ok(Math.abs(point.latitude-73)<1e-10);assert.ok(Math.abs(point.longitude-25)<1e-10);
});

test('shader adds a categorical independent mask, shares physical sunlight, and leaves the original map unchanged',()=>{
  const map=new Texture(),mask=new Texture(),sun=new Vector3(1,0,0),material=new MeshStandardMaterial({map});
  const initialVersion=map.version, uniforms=bindTitanGlint(material,mask,sun);
  assert.equal(material.map,map);assert.equal(map.version,initialVersion);assert.equal(uniforms.uTitanGlintSun.value,sun);
  assert.equal(mask.minFilter,NearestFilter);assert.equal(mask.generateMipmaps,false);
  const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader,{});
  assert.ok(shader.fragmentShader.includes('outgoingLight += vec3'));
  assert.ok(shader.fragmentShader.includes('texture2D(uTitanLakeMask, titanUv)'));
  assert.ok(shader.fragmentShader.includes('#include <map_fragment>'));
  assert.ok(shader.vertexShader.includes('vTitanPosition = (modelMatrix'));
});
