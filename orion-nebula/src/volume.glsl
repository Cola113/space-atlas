uniform mat4 uCameraMatrix;
uniform vec3 uEye;
uniform float uAspect;
uniform float uFov;
uniform float uExposure;
uniform int uSteps;
varying vec2 vUv;
// FIELD_FUNCTIONS
void main(){
 vec2 ndc=vUv*2.-1.;
 vec3 ray=normalize(mat3(uCameraMatrix)*vec3(ndc.x*uAspect*uFov,ndc.y*uFov,-1.));
 vec2 range=intersectCloud(uEye,ray);
 vec3 rgb=vec3(.00006,.00009,.00016);float trans=1.;
 if(range.y>range.x){
  float stepSize=(range.y-range.x)/float(uSteps);
  float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
  for(int i=0;i<192;i++){
   if(i>=uSteps||trans<.007)break;
   vec3 p=uEye+ray*(range.x+(float(i)+jitter)*stepSize);
   float distanceToWall=wallDistance(p);
   vec4 cell=field(p);float ext=extinction(cell);
   float alpha=1.-exp(-ext*stepSize);
   // A soft emitting stratum preserves the observation without a solid textured surface.
   vec2 uv=referenceUv(p);
   float detailProfile=exp(-distanceToWall*distanceToWall/1.3)*imageMask(uv);
   float facing=smoothstep(.18,.7,abs(dot(ray,wallNormal(p))));
   float nearDetail=smoothstep(3.,20.,length(p-uEye));
   float projection=smoothstep(.55,.94,dot(ray,normalize(p-vec3(0.,0.,44.))));
   float detailLod=mix(5.,0.,facing)+mix(3.,0.,nearDetail)+(1.-projection)*5.;
   vec3 observed=textureLod(uDetail,uv,detailLod).rgb;
   float grain=texture(uNoise,p*.09).b;
   rgb+=trans*observed*detailProfile*stepSize*.32*(.35+facing*.65)*nearDetail*(.3+projection*.7)*(.65+grain*.7);
   vec3 lightDirection=normalize(vec3(-1.7,1.6,-4.)-p);
   float shadow=exp(-baseField(p+lightDirection*1.2).r*2.);
   float illumination=.1+1.5/(1.+dot(p-vec3(-1.7,1.6,-4.),p-vec3(-1.7,1.6,-4.))*.03);
   vec3 color=cloudColor(cell,p)*cell.r*mix(1.15,.14*illumination,cell.b)/max(ext,.0001)*(.18+.82*shadow);
   rgb+=trans*alpha*color;trans*=1.-alpha;
  }
 }
 rgb=1.-exp(-rgb*uExposure*2.5);
 gl_FragColor=vec4(rgb,1.);
 #include <colorspace_fragment>
}
