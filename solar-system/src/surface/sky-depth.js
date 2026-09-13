// Celestial meshes keep compact display coordinates, but every fragment writes
// depth from its physical camera-space distance. Comparing compressed sphere
// centers is insufficient: a foreground moon can fall inside the parent mesh.
// Reserve a depth band behind the 100-unit terrain and ahead of 2000-unit stars.
export function skyDepthParameters(targets) {
  const near=Math.max(1,Math.min(...targets.map(t=>t.distanceKm-t.radiusKm))/4);
  const far=Math.max(near*2,...targets.map(t=>(t.distanceKm+t.radiusKm)*2));
  return [near,Math.log(far/near)];
}

export function skyDepthValue(viewDistanceKm,[near,logRange]) {
  return .91+.08*Math.max(0,Math.min(1,Math.log(Math.max(near,viewDistanceKm)/near)/logRange));
}

export function bindSkyDepth(material,physicalPerDisplay,parameters) {
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer) {
    previous.call(this,shader,renderer);
    shader.uniforms.uSkyPhysicalScale=physicalPerDisplay;
    shader.uniforms.uSkyDepthRange=parameters;
    shader.vertexShader='varying float vSkyViewDepth;\n'+shader.vertexShader.replace(
      '#include <project_vertex>','#include <project_vertex>\n vSkyViewDepth = -mvPosition.z;');
    shader.fragmentShader='varying float vSkyViewDepth;\nuniform float uSkyPhysicalScale;\nuniform vec2 uSkyDepthRange;\n'+shader.fragmentShader.replace(
      '#include <logdepthbuf_fragment>',
      'gl_FragDepth = .91 + .08 * clamp(log(max(uSkyDepthRange.x,vSkyViewDepth*uSkyPhysicalScale)/uSkyDepthRange.x)/uSkyDepthRange.y,0.,1.);');
  };
  material.customProgramCacheKey=()=>key+'-physical-sky-depth-v1';
  material.needsUpdate=true;
}
