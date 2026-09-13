import { ShaderChunk } from 'three';

// Install after other hooks so their occlusion sees the physical Sun direction.
export function bindPhysicalSun(material, direction) {
  if(!material || material.isShaderMaterial || material.isMeshBasicMaterial || material.userData.physicalSun)return;
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    previous.call(this,shader,renderer);
    shader.uniforms.uPhysicalSun={value:direction};
    shader.fragmentShader='uniform vec3 uPhysicalSun;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',ShaderChunk.lights_fragment_begin)
      .replace(/get(?:Point|Directional)LightInfo\([^;]+;/g,'$&\n directLight.direction = normalize(mat3(viewMatrix) * uPhysicalSun);');
  };
  material.customProgramCacheKey=()=>previousKey+'-physical-sun-v1';
  material.userData.physicalSun=true;material.needsUpdate=true;
}
