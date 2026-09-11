// Mean radii and orbital sizes, in km and AU respectively. Sources:
// https://ssd.jpl.nasa.gov/planets/phys_par.html
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
// https://ssd.jpl.nasa.gov/sats/phys_par/
// https://ssd.jpl.nasa.gov/sats/elem/
// https://science.nasa.gov/sun/facts/
// https://science.nasa.gov/solar-system/asteroids/4-vesta/
// Small-body orbital sizes are rounded means, not positional ephemerides.
export const physicalData = {
  sun: { radiusKm: 696340, orbitAU: 0 },
  mercury: { radiusKm: 2439.4, orbitAU: 0.38709927, orbitYears: 0.2408467 },
  venus: { radiusKm: 6051.8, orbitAU: 0.72333566, orbitYears: 0.61519726 },
  earth: { radiusKm: 6371.0084, orbitAU: 1.00000261, orbitYears: 1.0000174 },
  mars: { radiusKm: 3389.5, orbitAU: 1.52371034, orbitYears: 1.8808476 },
  jupiter: { radiusKm: 69911, orbitAU: 5.202887, orbitYears: 11.862615 },
  saturn: { radiusKm: 58232, orbitAU: 9.53667594, orbitYears: 29.447498 },
  uranus: { radiusKm: 25362, orbitAU: 19.18916464, orbitYears: 84.016846 },
  neptune: { radiusKm: 24622, orbitAU: 30.06992276, orbitYears: 164.79132 },
  pluto: { radiusKm: 1188.3, orbitAU: 39.48211675, orbitYears: 247.92065 },
  ceres: { radiusKm: 469.7, orbitAU: 2.77 },
  vesta: { radiusKm: 262.7, orbitAU: 2.36 },
  moon: { radiusKm: 1737.4, orbitKm: 384400 },
  phobos: { radiusKm: 11.08, orbitKm: 9375 },
  io: { radiusKm: 1821.49, orbitKm: 421800 },
  europa: { radiusKm: 1560.8, orbitKm: 671100 },
  ganymede: { radiusKm: 2631.2, orbitKm: 1070400 },
  callisto: { radiusKm: 2410.3, orbitKm: 1882700 },
  enceladus: { radiusKm: 252.1, orbitKm: 238400 },
  titan: { radiusKm: 2574.76, orbitKm: 1221900 },
  triton: { radiusKm: 1352.6, orbitKm: 354800 },
  charon: { radiusKm: 606, orbitKm: 19600 },
  deimos: { radiusKm: 6.2, orbitKm: 23460 },
  miranda: { radiusKm: 235.8, orbitKm: 129900 },
  amalthea: { radiusKm: 83.5, orbitKm: 181400 },
  thebe: { radiusKm: 49.3, orbitKm: 221900 },
  adrastea: { radiusKm: 8.2, orbitKm: 128900 },
  metis: { radiusKm: 21.5, orbitKm: 128300 },
  himalia: { radiusKm: 67, orbitKm: 11460000 },
  mimas: { radiusKm: 198.2, orbitKm: 185540 },
  tethys: { radiusKm: 531.1, orbitKm: 294660 },
  dione: { radiusKm: 561.4, orbitKm: 377400 },
  rhea: { radiusKm: 763.5, orbitKm: 527040 },
  iapetus: { radiusKm: 734.3, orbitKm: 3561300 },
  phoebe: { radiusKm: 106.5, orbitKm: 12952000 },
  hyperion: { radiusKm: 135, orbitKm: 1481000 },
  janus: { radiusKm: 89.5, orbitKm: 151460 },
  epimetheus: { radiusKm: 58.1, orbitKm: 151410 },
  prometheus: { radiusKm: 43.1, orbitKm: 139350 },
  pandora: { radiusKm: 40.7, orbitKm: 141700 },
  atlas: { radiusKm: 15.1, orbitKm: 137670 },
  pan: { radiusKm: 14.1, orbitKm: 133580 },
};
