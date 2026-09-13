import { physicalDefinitions, JULIAN_YEAR_DAYS, sourceFor } from './physics/definitions.js';

// Compatibility view for angular sizes, catalogue sorting and display scaling.
// All numerical values are derived from the canonical physical registry.
export const physicalData = Object.freeze(Object.fromEntries(
  Object.entries(physicalDefinitions.bodies).map(([id, body]) => {
    const { radius, orbit } = body;
    return [id, Object.freeze({
      radiusKm: radius.value, radiusType: radius.type,
      radiusSource: sourceFor(radius.source).url,
      radiusEpoch: radius.epoch, radiusUncertaintyKm: radius.uncertainty,
      estimated: Boolean(radius.estimated),
      ...(orbit.a.unit === 'km' ? { orbitKm: orbit.a.value } : { orbitAU: orbit.a.value }),
      ...(orbit.periodDays ? { orbitYears: orbit.periodDays / JULIAN_YEAR_DAYS } : {}),
      orbitSource: sourceFor(orbit.source).url, epoch: orbit.epochTdbJd,
      units: Object.freeze({ radiusKm: 'km', orbitKm: 'km', orbitAU: 'au', orbitYears: 'Julian year' }),
      validity: `${radius.validity} ${orbit.validity}`,
    })];
  })
));

export function radiusFact(id) {
  const radius = physicalDefinitions.bodies[id].radius;
  return [radius.label, radius.value.toLocaleString('en-US', { maximumFractionDigits: 2 }), 'km'];
}
