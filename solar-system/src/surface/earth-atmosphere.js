// Display atmosphere for the artistic Mauna Kea panorama. These colours are
// not a radiative-transfer model; the Sun direction comes from the shared sky.
// Work in linear colour so the renderer applies the sRGB transfer only once.
export const earthAtmosphereGLSL = `
vec3 earthSkyColour(vec3 direction, vec3 solarDirection, float solarAltitude) {
  float up=max(direction.y,0.);
  float alignment=max(0.,dot(direction,solarDirection));
  float day=smoothstep(-7.,10.,solarAltitude);
  float horizon=exp(-up*5.5);
  vec3 blue=mix(vec3(.012,.055,.18),vec3(.32,.51,.73),horizon)*day;
  float twilight=exp(-pow((solarAltitude+1.)/7.,2.));
  float facing=pow(max(0.,dot(normalize(vec3(direction.x,.001,direction.z)),
    normalize(vec3(solarDirection.x,.001,solarDirection.z)))),4.);
  vec3 amber=vec3(.58,.18,.038)*exp(-up*9.)*facing*twilight;
  vec3 rose=vec3(.065,.019,.058)*exp(-pow((up-.10)*5.,2.))*twilight*(1.-facing*.7);
  float glow=pow(alignment,80.)*.09+pow(alignment,900.)*.13;
  return blue+amber+rose+vec3(1.,.72,.42)*glow*day;
}
vec3 earthLightTint(float solarAltitude, float brightness) {
  vec3 night=mix(vec3(.58,.72,1.),vec3(1.),smoothstep(.025,.3,brightness));
  float warm=smoothstep(-9.,1.,solarAltitude)*(1.-smoothstep(2.,17.,solarAltitude));
  return night*mix(vec3(1.),vec3(1.16,.70,.43),warm*.7);
}
`;

// Colour samples drift at two depths. They share a smooth, stationary horizon;
// terrain is an independent foreground draw and never enters this texture.
export const earthCloudFragment = `
uniform sampler2D panorama;
uniform float center;
uniform vec3 wind;
uniform float daylight;
uniform float sunAlt;
uniform vec3 sun;
varying vec3 direction;
${earthAtmosphereGLSL}
vec3 cloudSample(vec2 uv, vec2 dx, vec2 dy, float hours) {
  float near=clamp((.5-uv.y)*7.,0.,1.);
  float drift=hours*mix(.00035,.0013,near);
  vec2 bend=vec2(sin(uv.y*49.+hours*.024),cos(uv.x*31.+hours*.018))*.00065*near;
  return textureGrad(panorama,uv+vec2(drift,0.)+bend,dx,dy).rgb;
}
void main() {
  vec3 d=normalize(direction);
  if(d.y>.012)discard;
  vec2 uv=vec2((atan(d.x,-d.z)-center)/6.28318530718+.5,
    .5+asin(clamp(d.y,-1.,1.))/3.14159265359);
  vec2 dx=dFdx(uv),dy=dFdy(uv);dx.x-=round(dx.x);dy.x-=round(dy.x);
  vec3 clouds=mix(cloudSample(uv,dx,dy,wind.x),cloudSample(uv,dx,dy,wind.y),wind.z);
  vec3 lit=clouds*daylight*earthLightTint(sunAlt,daylight);
  float haze=exp(-max(-d.y,0.)*34.)*smoothstep(-9.,6.,sunAlt)*.7;
  lit=mix(lit,earthSkyColour(d,sun,sunAlt),haze);
  float alpha=1.-smoothstep(-.037,.002,d.y);
  gl_FragColor=vec4(lit,alpha);
  #include <colorspace_fragment>
}
`;
