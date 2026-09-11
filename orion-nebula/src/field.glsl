precision highp sampler3D;
uniform sampler3D uField;
uniform sampler3D uNoise;
uniform sampler2D uDetail;
const vec3 extent=vec3(32.,24.,26.);
vec2 intersectCloud(vec3 origin,vec3 ray){
 vec3 safeRay=mix(vec3(.000001),ray,step(vec3(.000001),abs(ray)));
 vec3 a=(-extent-origin)/safeRay,b=(extent-origin)/safeRay;
 vec3 lo=min(a,b),hi=max(a,b);
 return vec2(max(0.,max(lo.x,max(lo.y,lo.z))),min(hi.x,min(hi.y,hi.z)));
}
vec2 referenceUv(vec3 p){return p.xy/(32.*(1.-p.z/44.))+.5;}
float wallDepth(vec2 uv){
 vec2 q=(uv-vec2(.445,.55))/.23,k=(uv-vec2(.315,.79))/vec2(.09,.11);
 return -9.+13.*(1.-exp(-dot(q,q)))-2.4*sin(uv.x*8.+uv.y*5.)+exp(-dot(k,k))*3.;
}
float wallDistance(vec3 p){return p.z-wallDepth(referenceUv(p));}
vec3 wallNormal(vec3 p){
 vec2 uv=referenceUv(p),q=(uv-vec2(.445,.55))/.23,k=(uv-vec2(.315,.79))/vec2(.09,.11);
 vec2 slope=26.*exp(-dot(q,q))*q/.23-cos(uv.x*8.+uv.y*5.)*vec2(19.2,12.)-6.*exp(-dot(k,k))*k/vec2(.09,.11);
 return normalize(vec3(-slope/(32.*(1.-p.z/44.)),1.-dot(slope,uv-.5)/(44.-p.z)));
}
float imageMask(vec2 uv){return smoothstep(0.,.12,min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y)))*(1.-smoothstep(.48,.72,length((uv-.5)*vec2(.93,1.))));}
vec4 baseField(vec3 p){return texture(uField,p/(extent*2.)+.5);}
vec4 field(vec3 p){
 vec4 cell=baseField(p);
 if(cell.r+cell.g<.0005)return cell;
 vec3 warp=(texture(uNoise,p*.013).rgb-.5)*1.6;
 float n=texture(uNoise,(p+warp)*.024).r*.7+texture(uNoise,(p+warp)*.054).g*.3;
 float fine=pow(max(0.,n-.22)*2.8,2.);
 float pockets=texture(uNoise,(p+warp)*.006).b*.65+texture(uNoise,p*.015).r*.35;
 float structure=pow(smoothstep(.25,.72,pockets),2.);
 cell.r*=mix(fine,(.035+structure*2.6)*(.45+fine*.55),cell.b);cell.g*=.65+fine*.35;
 return cell;
}
float extinction(vec4 cell){return cell.r*1.35+cell.g*4.2;}
vec3 cloudColor(vec4 cell,vec3 p){
 vec3 image=textureLod(uDetail,referenceUv(p),5.).rgb;
 float tint=.5+.5*sin(p.x*.08-p.y*.07+p.z*.06);
 vec3 surround=mix(vec3(.033,.078,.106),vec3(.15,.055,.042),tint);
 return mix(surround,image,cell.b);
}
float starTransmission(vec3 eye,vec3 star){
 vec3 offset=star-eye;float distance=length(offset);vec3 ray=offset/max(distance,.0001);
 vec2 range=intersectCloud(eye,ray);range.y=min(range.y,distance);
 if(range.y<=range.x)return 1.;
 float stepSize=(range.y-range.x)/48.,optical=0.;
 for(int i=0;i<48;i++){optical+=extinction(field(eye+ray*(range.x+(float(i)+.5)*stepSize)))*stepSize;}
 return exp(-optical);
}
