import data from './body-definitions.json';
import iau from './iau-coefficients.json';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// The registry is the authority for physical constants and model selection.
// Provider coefficient files contain their own unique numerical definitions.
export const physicalDefinitions = freeze(data);
export const AU_KM = data.constants.auKm;
export const JULIAN_YEAR_DAYS = data.constants.julianYearDays;
export const sourceFor = key => data.sources[key];
export function rotationPeriodDays(id) {
  const rotation = data.bodies[id].rotation;
  return rotation.provider === 'iau-pck'
    ? 360 / Math.abs(iau.bodies[rotation.coefficients].PM[1])
    : rotation.periodDays;
}

// Derived view for motion consumers; no second table of orbital/rotation data.
export const meanElements = freeze({ bodies: Object.fromEntries(
  Object.entries(data.bodies).filter(([, body]) => body.orbit.provider === 'mean-kepler')
    .map(([id, body]) => [id, { ...body.orbit, parent: body.parent,
      orbitFrame: body.orbit.center, spinDays: rotationPeriodDays(id),
      tumbling: body.rotation.provider === 'illustrative-tumbling' }])
) });
