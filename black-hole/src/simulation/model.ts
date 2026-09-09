export const MODEL = Object.freeze({
  horizon: 1,
  photonSphere: 1.5,
  criticalImpact: Math.sqrt(27) / 2,
  diskInner: 3,
  diskOuter: 9,
  maxPhi: 4 * Math.PI,
});

export interface Appearance {
  exposure: number;
  bloom: number;
  diskIntensity: number;
  stars: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
  exposure: 1.15,
  bloom: 0.28,
  diskIntensity: 1,
  stars: 1,
};

export const mod = (value: number, period: number) => ((value % period) + period) % period;

// Two staggered finite-lifetime flow fields prevent unbounded differential shear.
export function timePhases(time: number) {
  return {
    flow: mod(time, 48),
    pulse: mod(time, 120) * Math.PI * 2 / 120,
  };
}
