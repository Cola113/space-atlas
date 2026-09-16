// Mars polar frost, as a function of the planet's own season.
//
// The two caps are seasonal CO2 frost, and their extent is measured against the areocentric solar
// longitude L_s, which the app computes from the simulation date. L_s = 0 is the northern spring
// equinox, 90 the northern summer solstice, 180 the autumn equinox, 270 the northern winter
// solstice. Mars's orbit is eccentric enough that southern summer falls near perihelion: the south
// cap loses its CO2 entirely by L_s = 270, while the north cap keeps a water-ice remnant all year.
//
// This supplies the *extent* of the frost in degrees of latitude, which is the measured part. How it
// is shaded on the globe is a display approximation, and is documented as one.
import {Body, Ecliptic, HelioVector} from 'astronomy-engine';

// The node of Mars's equator on the ecliptic; L_s is measured from it.
const VERNAL_NODE_DEGREES = 85.06;

export function marsSolarLongitude(date) {
  const {elon} = Ecliptic(HelioVector(Body.Mars, date));
  return ((elon - VERNAL_NODE_DEGREES) % 360 + 360) % 360;
}

// A cap is widest in its own winter, when its edge reaches lowest in latitude: the northern edge
// runs from about 80N in northern summer out to about 55N in northern winter, and the southern edge
// from about 87S in southern summer out to about 55S in southern winter.
const NORTH_SUMMER_EDGE = 80, NORTH_WINTER_EDGE = 55;
const SOUTH_SUMMER_EDGE = 87, SOUTH_WINTER_EDGE = 55;

export function marsPolarFrostEdges(solarLongitude) {
  const winterFraction = peak => (1 + Math.cos((solarLongitude - peak) * Math.PI / 180)) / 2;
  const north = NORTH_SUMMER_EDGE + (NORTH_WINTER_EDGE - NORTH_SUMMER_EDGE) * winterFraction(270);
  const south = SOUTH_SUMMER_EDGE + (SOUTH_WINTER_EDGE - SOUTH_SUMMER_EDGE) * winterFraction(90);
  return {northLatitude: north, southLatitude: -south};
}
