import { radiusFact } from './physical-scale.js';
import { physicalDefinitions, rotationPeriodDays, JULIAN_YEAR_DAYS } from './physics/definitions.js';

const number = value => value.toLocaleString('en-US', {maximumFractionDigits:2});
export function resolvePhysicalFacts(body) {
  const orbit = physicalDefinitions.bodies[body.id].orbit;
  return body.facts.map(fact => {
    const [quantity, unit] = fact;
    if (quantity === 'physical:radius') return radiusFact(body.id);
    if (quantity === 'physical:orbit') {
      const divisor = unit==='年'?JULIAN_YEAR_DAYS:unit==='小时'?1/24:1;
      return ['公转周期 · 约', number(orbit.periodDays/divisor), unit];
    }
    if (quantity === 'physical:spin') return ['自转周期 · 约',number(rotationPeriodDays(body.id)*24),'小时'];
    if (quantity === 'physical:distance') return ['轨道半长轴 · 约',number(orbit.a.value),orbit.a.unit==='au'?'AU':'km'];
    if (quantity === 'physical:inclination') {
      const plane = {ecliptic:'黄道',Laplace:'拉普拉斯面',equatorial:'主星赤道','J2000-equatorial':'J2000 赤道'}[orbit.referencePlane];
      return [`轨道倾角 · ${plane}`, number(orbit.inclinationDegrees),'°'];
    }
    return fact;
  });
}
