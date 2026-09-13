import { WebGLRenderer, ShaderMaterial, Scene, Mesh, PlaneGeometry, OrthographicCamera, PerspectiveCamera, Data3DTexture, Texture, TextureLoader, RepeatWrapping, LinearFilter, RGBAFormat, UnsignedByteType, SRGBColorSpace, Vector3, Matrix4, BufferGeometry, Float32BufferAttribute, Points, AdditiveBlending } from 'three';
import fragment from './volume.glsl?raw';
import fieldShader from './field.glsl?raw';
import { EXTENT, FIELD_SIZE } from './Field';
import { AdaptiveQuality, profiles, type Quality } from './Quality';
export type { Quality } from './Quality';
export class NebulaRenderer {
 readonly renderer:WebGLRenderer;
 private scene=new Scene();
 private screenCamera=new OrthographicCamera(-1,1,1,-1,0,1);
 private geometry=new PlaneGeometry(2,2);
 private stars=new Scene();
 private starGeometry=new BufferGeometry();
 private map:Data3DTexture|null=null;
 private detail:Texture|null=null;
 private noise:Data3DTexture|null=null;
 private data:Uint8Array|null=null;
 private worker:Worker|null=null;
 private cancelWorker=()=>{};
 private abort=new AbortController();
 private starMaterial=new ShaderMaterial({
  transparent:true,depthWrite:false,depthTest:false,blending:AdditiveBlending,
  uniforms:{uField:{value:null},uNoise:{value:null},uDetail:{value:null},uEye:{value:new Vector3()},uScale:{value:1},uBrightness:{value:.7},uStarSteps:{value:48},uDetailLevel:{value:2}},
  vertexShader:fieldShader+String.raw
`
attribute vec3 tint; attribute float power; varying vec3 vTint; varying float vPower; varying float vTransmission; varying float vSize;
uniform vec3 uEye; uniform float uScale;
void main(){
 vec4 world=modelMatrix*vec4(position,1.);vec4 p=viewMatrix*world;
 gl_Position=projectionMatrix*p;
 gl_PointSize=clamp(power*120./max(.7,-p.z),3.,32.)*uScale;vSize=gl_PointSize;
 vTint=tint;vPower=power;
 vTransmission=starTransmission(uEye,world.xyz)*smoothstep(.15,.9,length(world.xyz-uEye));
}`,
  fragmentShader:String.raw
`
varying vec3 vTint; varying float vPower; varying float vTransmission;varying float vSize;uniform float uBrightness;
void main(){
 float r=length((gl_PointCoord-.5)*vSize);
 float core=exp(-r*r/1.05),halo=exp(-r*r/max(1.,vSize*vSize*.085))*.045;
 float alpha=(core+halo)*(1.-smoothstep(vSize*.36,vSize*.5,r))*vTransmission*uBrightness;
 gl_FragColor=vec4(vTint*min(2.,vPower),alpha);
}`,
 });
 private material=new ShaderMaterial({
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:fragment.replace('// FIELD_FUNCTIONS',fieldShader),depthTest:false,depthWrite:false,
  uniforms:{uField:{value:null},uNoise:{value:null},uDetail:{value:null},uCameraMatrix:{value:new Matrix4()},uEye:{value:new Vector3()},uAspect:{value:1},uFov:{value:1},uExposure:{value:1.25},uSteps:{value:96},uStarSteps:{value:48},uDetailLevel:{value:2}},
 });
 readonly errors:string[]=[];
 readonly adaptive=new AdaptiveQuality(()=>this.resize(innerWidth,innerHeight));
 get quality(){return this.adaptive.mode;}
 get current(){return this.adaptive.current;}
 private essentialStars=0;
 exposure=1.25;
 starBrightness=.7;
 frames=0;

 private disposed=false;
 constructor(canvas:HTMLCanvasElement){
  this.renderer=new WebGLRenderer({canvas,alpha:false,antialias:false,powerPreference:'high-performance'});
  this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.autoClear=false;
  this.renderer.debug.onShaderError=(gl,program)=>{const error=gl.getProgramInfoLog(program)||'Shader compilation failed';this.errors.push(error);console.error(error);};
  const quad=new Mesh(this.geometry,this.material);quad.frustumCulled=false;this.scene.add(quad);
 }
 async initialize(){
  const build=new Promise<Uint8Array>((resolve,reject)=>{
   this.worker=new Worker(new URL('./field.worker.ts',import.meta.url),{type:'module'});
   this.cancelWorker=()=>reject(new Error('Scene disposed'));
   this.worker.onmessage=event=>{this.worker?.terminate();this.worker=null;event.data.error?reject(new Error(event.data.error)):resolve(event.data.data);};
   this.worker.onerror=()=>{this.worker?.terminate();this.worker=null;reject(new Error('三维云场未能建立'));};
   this.worker.postMessage({});
  });
  const [volume,stars,image]=await Promise.allSettled([build,fetch('/orion-nebula/stars.json',{signal:this.abort.signal}).then(r=>{if(!r.ok)throw new Error('星点资料未能加载');return r.json();}),new TextureLoader().loadAsync('/orion-nebula/cloud-guide.webp')]);
  if(this.disposed){if(image.status==='fulfilled')image.value.dispose();return;}
  if(volume.status==='rejected'||stars.status==='rejected'||image.status==='rejected'){
   if(image.status==='fulfilled')image.value.dispose();
   throw new Error('星云体积或参考素材未能加载');
  }
  this.detail=image.value;this.detail.colorSpace=SRGBColorSpace;
  this.material.uniforms.uDetail.value=this.detail;this.starMaterial.uniforms.uDetail.value=this.detail;
  this.data=volume.value;
  const [nx,ny,nz]=FIELD_SIZE;
  this.map=new Data3DTexture(this.data,nx,ny,nz);this.map.format=RGBAFormat;this.map.type=UnsignedByteType;
  this.map.minFilter=LinearFilter;this.map.magFilter=LinearFilter;this.map.unpackAlignment=1;this.map.needsUpdate=true;
  this.material.uniforms.uField.value=this.map;this.starMaterial.uniforms.uField.value=this.map;
  const noiseData=new Uint8Array(64*64*64*4);let noiseSeed=771;
  for(let i=0;i<noiseData.length;i++){noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;noiseData[i]=noiseSeed>>>24;}
  this.noise=new Data3DTexture(noiseData,64,64,64);this.noise.format=RGBAFormat;
  this.noise.minFilter=LinearFilter;this.noise.magFilter=LinearFilter;this.noise.wrapS=RepeatWrapping;this.noise.wrapT=RepeatWrapping;this.noise.wrapR=RepeatWrapping;this.noise.needsUpdate=true;
  this.material.uniforms.uNoise.value=this.noise;this.starMaterial.uniforms.uNoise.value=this.noise;
  const positions:number[]=[],colors:number[]=[],powers:number[]=[];
  const add=(x:number,y:number,z:number,power:number,tint:number[])=>{positions.push(x,y,z);colors.push(...tint);powers.push(power);};
  let seed=1926;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(const star of stars.value as {x:number;y:number;power:number;color:number[]}[]){
   const z=random()*17-8,scale=32*(1-z/44);
   add((star.x-.5)*scale,(.5-star.y)*scale,z,Math.min(1.4,star.power)*1.3,star.color.map(v=>Math.max(.48,v)));
  }
  for(const [x,y,z,power] of [[-1.9,1.8,-3.8,2.1],[-1.25,2.05,-4.3,1.65],[-1.5,1.25,-3.6,1.45],[-2.15,1.25,-4,1.4],[-5.5,8.7,1,1.8]])add(x,y,z,power,[.72,.86,1]);
  this.essentialStars=powers.length;
  // Additional stars provide all-direction depth; these positions are illustrative.
  for(let i=0;i<6200;i++){
   const theta=random()*Math.PI*2,cy=random()*2-1,radius=70+random()*150,s=Math.sqrt(1-cy*cy);
   const warm=random()>.7;
   add(Math.cos(theta)*s*radius,cy*radius,Math.sin(theta)*s*radius,.1+Math.pow(random(),3)*1.25,warm?[1,.82,.65]:[.72,.83,1]);
  }
  for(let i=0;i<1800;i++)add((random()-.5)*100,(random()-.5)*75,random()*55-35,.08+Math.pow(random(),2)*.72,[.8,.88,1]);
  for(let i=0;i<220;i++)add(-1.7+(random()-.5)*12,1.6+(random()-.5)*10,-4+(random()-.5)*14,.1+random()*.8,[.82,.88,1]);

  this.starGeometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  this.starGeometry.setAttribute('tint',new Float32BufferAttribute(colors,3));
  this.starGeometry.setAttribute('power',new Float32BufferAttribute(powers,1));
  this.stars.add(new Points(this.starGeometry,this.starMaterial));
  this.resize(innerWidth,innerHeight);
  await this.renderer.compileAsync(this.scene,this.screenCamera);
  if(this.errors.length)throw new Error('星云着色器初始化失败');
 }
 resize(width:number,height:number){
  const profile=profiles[this.current];
  const ratio=Math.min(devicePixelRatio,profile.ratio,Math.sqrt(profile.pixels/(width*height)));
  this.renderer.setPixelRatio(ratio);this.renderer.setSize(width,height,false);
  this.material.uniforms.uSteps.value=profile.steps;this.starMaterial.uniforms.uScale.value=ratio;
  for(const material of [this.material,this.starMaterial]){material.uniforms.uStarSteps.value=profile.starSteps;material.uniforms.uDetailLevel.value=profile.detail;}
  this.starGeometry.setDrawRange(0,this.essentialStars+profile.background);
 }
 setQuality(value:Quality){this.adaptive.set(value,performance.now());}
 sample(ms:number,now:number){this.adaptive.sample(ms,now);}
 resetSampling(){this.adaptive.reset(performance.now());}
 get profile(){return profiles[this.current];}
 render(camera:PerspectiveCamera){
  if(this.disposed||!this.map)return;
  camera.updateMatrixWorld();
  this.material.uniforms.uCameraMatrix.value.copy(camera.matrixWorld);this.material.uniforms.uEye.value.copy(camera.position);
  this.material.uniforms.uAspect.value=camera.aspect;this.material.uniforms.uFov.value=Math.tan(camera.fov*Math.PI/360);
  this.material.uniforms.uExposure.value=this.exposure;
  this.starMaterial.uniforms.uEye.value.copy(camera.position);this.starMaterial.uniforms.uBrightness.value=this.starBrightness;
  this.renderer.clear();this.renderer.render(this.scene,this.screenCamera);this.renderer.render(this.stars,camera);this.frames++;
 }
 // Conservative coarse visibility for labels; stars use the detailed GPU field.
 transmission(from:Vector3,to:Vector3){
  if(!this.data)return 1;
  const [nx,ny,nz]=FIELD_SIZE,delta=to.clone().sub(from),length=delta.length(),steps=Math.max(16,Math.ceil(length*2));
  let optical=0;
  for(let i=0;i<steps;i++){
   const p=from.clone().addScaledVector(delta,(i+.5)/steps);
   if(Math.abs(p.x)>=EXTENT[0]||Math.abs(p.y)>=EXTENT[1]||Math.abs(p.z)>=EXTENT[2])continue;
   const x=Math.round((p.x/(2*EXTENT[0])+.5)*(nx-1)),y=Math.round((p.y/(2*EXTENT[1])+.5)*(ny-1)),z=Math.round((p.z/(2*EXTENT[2])+.5)*(nz-1));
   const index=(x+nx*(y+ny*z))*4;optical+=(this.data[index]*1.35+this.data[index+1]*4.2)/255*length/steps;
  }
  return Math.exp(-optical);
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.abort.abort();this.worker?.terminate();this.worker=null;this.cancelWorker();
  this.map?.dispose();this.detail?.dispose();this.noise?.dispose();this.data=null;this.geometry.dispose();this.material.dispose();this.starGeometry.dispose();this.starMaterial.dispose();
  this.renderer.dispose();this.renderer.forceContextLoss();
 }
}
