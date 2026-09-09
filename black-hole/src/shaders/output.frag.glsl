uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uTexel;
uniform float uBloomAmount;
uniform float uExposure;
in vec2 vUv;
out vec4 outColor;

vec3 aces(vec3 c) { return clamp((c * (2.51*c+0.03)) / (c * (2.43*c+0.59)+0.14), 0.0, 1.0); }
float luma(vec3 c) { return dot(c,vec3(0.299,0.587,0.114)); }
vec3 displayAt(vec2 uv) { return aces((texture(uScene,uv).rgb + texture(uBloom,uv).rgb * uBloomAmount) * uExposure); }

void main() {
  vec3 center = displayAt(vUv);
  vec3 nw = displayAt(vUv + vec2(-1,1)*uTexel), ne = displayAt(vUv + uTexel);
  vec3 sw = displayAt(vUv - uTexel), se = displayAt(vUv + vec2(1,-1)*uTexel);
  float lnw=luma(nw), lne=luma(ne), lsw=luma(sw), lse=luma(se), lc=luma(center);
  float lmin=min(lc,min(min(lnw,lne),min(lsw,lse))), lmax=max(lc,max(max(lnw,lne),max(lsw,lse)));
  vec2 dir=vec2(-((lnw+lne)-(lsw+lse)),(lnw+lsw)-(lne+lse));
  float reduce=max((lnw+lne+lsw+lse)*0.03125,0.0078125);
  dir=clamp(dir/(min(abs(dir.x),abs(dir.y))+reduce),vec2(-6),vec2(6))*uTexel;
  vec3 a=0.5*(displayAt(vUv-dir/6.0)+displayAt(vUv+dir/6.0));
  vec3 b=a*0.5+0.25*(displayAt(vUv-dir*0.5)+displayAt(vUv+dir*0.5));
  float lb=luma(b);
  vec3 color=lmax-lmin<0.045 ? center : ((lb<lmin||lb>lmax) ? a : b);
  // Exactly one transfer to sRGB; offscreen passes remain linear HDR.
  color=mix(color*12.92,1.055*pow(max(color,vec3(0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),color));
  outColor=vec4(color,1.0);
}
