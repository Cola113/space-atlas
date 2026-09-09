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
};
