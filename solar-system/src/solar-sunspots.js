import * as THREE from 'three';

// Solar differential rotation and schematic bipolar sunspot groups.
//
// Scientific basis:
// - Sidereal differential rotation profile for magnetic tracers / sunspots from
//   Snodgrass & Ulrich (1990), ApJ 351, 309:
//     omega(phi) = A + B * sin^2(phi) + C * sin^4(phi)   [deg / day]
//   with A = 14.713, B = -2.396, C = -1.787 deg/day.
// - The Sun's rigid body mesh already rotates at the IAU Carrington sidereal rate
//   omega_C = 14.1844 deg/day (period 25.38 d, supplied by Astronomy Engine).
//   Therefore, features at latitude phi drift in Carrington east-positive longitude at
//   delta_omega(phi) = omega(phi) - omega_C: equatorial regions advance faster than the
//   Carrington frame (~24.47 d period) while latitudes above ~27 deg lag behind (~26.7 d
//   at 30 deg, ~34.2 d near the poles).
// - Boundaries (explicitly stated in UI and BODY_MODELS.md):
//   * This is an empirical surface rotation formula, not 3D magnetohydrodynamics (MHD).
//   * Sunspot group emergence times, longitudes, polarity morphology and the ~11-year
//     Schwabe/Sporer butterfly envelope are deterministic procedural schematics, not a
//     historical sunspot catalog or real-time space-weather forecast.

export const CARRINGTON_SIDEREAL_DEG_PER_DAY = 14.1844;
export const SOLAR_DIFF_ROTATION = Object.freeze({
  A: 14.713,
  B: -2.396,
  C: -1.787,
  carrington: CARRINGTON_SIDEREAL_DEG_PER_DAY,
});

export const MAX_SUNSPOT_GROUPS = 8;

const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DAY_MS = 86400000;
const DEG_TO_RAD = Math.PI / 180;
const CYCLE_DAYS = 11.0 * 365.25;
// Reference schematic solar minimum near late 2019 (Cycle 24/25 minimum, ~2019-12).
const CYCLE_MIN_DAY_J2000 = (Date.UTC(2019, 11, 15) - J2000_MS) / DAY_MS;

/** Sidereal solar rotation rate omega(latDeg) in deg/day (Snodgrass & Ulrich 1990). */
export function solarRotationRateDegPerDay(latitudeDeg) {
  const s = Math.sin(latitudeDeg * DEG_TO_RAD);
  const s2 = s * s;
  return SOLAR_DIFF_ROTATION.A + SOLAR_DIFF_ROTATION.B * s2 + SOLAR_DIFF_ROTATION.C * s2 * s2;
}

/** Sidereal rotation period in days at a given heliographic latitude. */
export function solarRotationPeriodDays(latitudeDeg) {
  return 360 / solarRotationRateDegPerDay(latitudeDeg);
}

/** Differential angular velocity relative to the rigid Carrington frame (deg/day). */
export function solarDifferentialDriftDegPerDay(latitudeDeg) {
  return solarRotationRateDegPerDay(latitudeDeg) - CARRINGTON_SIDEREAL_DEG_PER_DAY;
}

/** Schematic 11-year Schwabe cycle phase in [0, 1), with 0 at minimum and ~0.42 at maximum. */
export function schematicSolarCyclePhase(date) {
  const days = (toTimestamp(date) - J2000_MS) / DAY_MS;
  const raw = (days - CYCLE_MIN_DAY_J2000) / CYCLE_DAYS;
  return ((raw % 1) + 1) % 1;
}

/** Schematic cycle activity level in [0.15, 1.0]: quiet near minimum, strong near maximum. */
export function schematicSolarCycleActivity(date) {
  const phase = schematicSolarCyclePhase(date);
  // Asymmetric Schwabe profile: faster rise (~4.5 yr) than decline (~6.5 yr).
  const shaped = phase < 0.42
    ? Math.sin((phase / 0.42) * (Math.PI / 2))
    : Math.cos(((phase - 0.42) / 0.58) * (Math.PI / 2));
  const clamped = Math.max(0, Math.min(1, shaped));
  return 0.16 + 0.84 * Math.pow(clamped, 1.15);
}

function toTimestamp(date) {
  if (typeof date === 'number') return date;
  if (date instanceof Date) return date.getTime();
  return Date.parse(date);
}

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function smoothstep01(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Each slot spawns non-overlapping schematic active regions on staggered lifetimes.
const SLOT_CONFIGS = Object.freeze([
  { periodDays: 29.5, offsetDays: 2.1, hemisphere: 1, minActivity: 0.10, scale: 1.18 },
  { periodDays: 33.0, offsetDays: 14.7, hemisphere: -1, minActivity: 0.14, scale: 1.12 },
  { periodDays: 26.0, offsetDays: 7.4, hemisphere: 1, minActivity: 0.30, scale: 0.96 },
  { periodDays: 31.5, offsetDays: 21.3, hemisphere: -1, minActivity: 0.34, scale: 1.02 },
  { periodDays: 24.5, offsetDays: 11.9, hemisphere: 1, minActivity: 0.48, scale: 0.88 },
  { periodDays: 28.0, offsetDays: 3.8, hemisphere: -1, minActivity: 0.52, scale: 0.92 },
  { periodDays: 22.5, offsetDays: 17.6, hemisphere: 1, minActivity: 0.66, scale: 0.82 },
  { periodDays: 27.0, offsetDays: 9.2, hemisphere: -1, minActivity: 0.72, scale: 0.86 },
]);

/**
 * Deterministically evaluate active schematic sunspot groups at a given UTC date.
 * Each group's heliographic longitude advances strictly by the Snodgrass & Ulrich (1990)
 * differential drift rate relative to the Carrington frame over its lifetime.
 */
export function evaluateSunspots(date) {
  const ms = toTimestamp(date);
  if (!Number.isFinite(ms)) return [];
  const days = (ms - J2000_MS) / DAY_MS;
  const activity = schematicSolarCycleActivity(ms);
  const groups = [];

  for (let slot = 0; slot < SLOT_CONFIGS.length; slot++) {
    const cfg = SLOT_CONFIGS[slot];
    if (activity < cfg.minActivity) continue;
    const shifted = days + cfg.offsetDays;
    const epochIndex = Math.floor(shifted / cfg.periodDays);
    const ageDays = shifted - epochIndex * cfg.periodDays;
    const birthDays = epochIndex * cfg.periodDays - cfg.offsetDays;
    const birthPhase = (((birthDays - CYCLE_MIN_DAY_J2000) / CYCLE_DAYS) % 1 + 1) % 1;
    // Schematic Sporer butterfly belt evaluated at group emergence so latitude stays constant over its lifetime.
    const beltCenterLat = 28 - 20 * birthPhase;
    const seedBase = slot * 97.31 + epochIndex * 19.73;

    // Active window occupies ~84% of the slot cadence so groups emerge and decay naturally.
    const lifeDays = cfg.periodDays * (0.76 + 0.14 * hash01(seedBase + 1.3));
    if (ageDays > lifeDays) continue;
    const progress = ageDays / lifeDays;
    const envelope = smoothstep01(0.0, 0.16, progress) * (1 - smoothstep01(0.70, 1.0, progress));
    if (envelope <= 0.01) continue;

    // Spread latitudes across the active belt so lower- and higher-latitude groups show
    // unmistakable differential shear relative to one another.
    const latOffset = (hash01(seedBase + 2.7) - 0.5) * 18;
    const absLat = Math.max(5.5, Math.min(37, beltCenterLat + latOffset));
    const latitudeDeg = cfg.hemisphere * absLat;

    const birthLonDeg = hash01(seedBase + 4.9) * 360;
    const driftDegPerDay = solarDifferentialDriftDegPerDay(latitudeDeg);
    const longitudeDeg = (((birthLonDeg + driftDegPerDay * ageDays) % 360) + 360) % 360;

    // Joy's Law: leading spot slightly closer to equator than trailing spot.
    const tiltRad = cfg.hemisphere * (0.12 + 0.008 * absLat);
    const radiusRad = (0.072 + 0.036 * hash01(seedBase + 6.1)) * cfg.scale * (0.78 + 0.32 * activity);
    const strength = envelope * (0.76 + 0.24 * activity);
    const u = (((longitudeDeg + 180) % 360) + 360) % 360 / 360;
    const v = (latitudeDeg + 90) / 180;

    groups.push({
      slot,
      epochIndex,
      latitudeDeg,
      longitudeDeg,
      birthLonDeg,
      driftDegPerDay,
      rotationPeriodDays: solarRotationPeriodDays(latitudeDeg),
      ageDays,
      lifeDays,
      progress,
      radiusRad,
      strength,
      tiltRad,
      seed: hash01(seedBase + 8.3) * 100,
      u,
      v,
    });
  }
  return groups;
}

/** Return the prominent active sunspot group direction in Sun mesh local axes (or null). */
export function primarySunspotAnchor(date) {
  const groups = evaluateSunspots(date);
  if (!groups.length) return null;
  const best = groups.reduce((a, b) => (b.strength * b.radiusRad > a.strength * a.radiusRad ? b : a));
  const phi = best.u * Math.PI * 2;
  const theta = (1 - best.v) * Math.PI;
  const point = new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
  );
  return {
    point: point.clone().multiplyScalar(1.018),
    viewDirection: point.clone(),
    extent: 1,
    group: best,
  };
}

export function createSolarSunspotUniforms() {
  return {
    uSolarDays: { value: 0 },
    uSunspotCount: { value: 0 },
    // xyz = unit sphere center on Sun mesh (Three SphereGeometry convention), w = angular radius (rad)
    uSunspotPos: { value: Array.from({ length: MAX_SUNSPOT_GROUPS }, () => new THREE.Vector4(1, 0, 0, 0)) },
    // x = strength [0..1], y = Joy's law tilt (rad), z = morphology seed, w = hemisphere sign
    uSunspotMeta: { value: Array.from({ length: MAX_SUNSPOT_GROUPS }, () => new THREE.Vector4(0, 0, 0, 1)) },
  };
}

export function updateSolarSunspotUniforms(uniforms, date, enabled = true) {
  const ms = toTimestamp(date);
  const days = Number.isFinite(ms) ? (ms - J2000_MS) / DAY_MS : 0;
  uniforms.uSolarDays.value = days;
  const groups = enabled ? evaluateSunspots(ms) : [];
  const count = Math.min(groups.length, MAX_SUNSPOT_GROUPS);
  uniforms.uSunspotCount.value = count;
  for (let i = 0; i < MAX_SUNSPOT_GROUPS; i++) {
    if (i < count) {
      const g = groups[i];
      const phi = g.u * Math.PI * 2;
      const theta = (1 - g.v) * Math.PI;
      uniforms.uSunspotPos.value[i].set(
        -Math.cos(phi) * Math.sin(theta),
        Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        g.radiusRad,
      );
      uniforms.uSunspotMeta.value[i].set(
        g.strength,
        g.tiltRad,
        g.seed,
        g.latitudeDeg >= 0 ? 1 : -1,
      );
    } else {
      uniforms.uSunspotPos.value[i].set(1, 0, 0, 0);
      uniforms.uSunspotMeta.value[i].set(0, 0, 0, 1);
    }
  }
  return groups;
}

export const SOLAR_SUNSPOT_GLSL = /* glsl */ `
  uniform float uSolarDays;
  uniform int uSunspotCount;
  uniform vec4 uSunspotPos[${MAX_SUNSPOT_GROUPS}];
  uniform vec4 uSunspotMeta[${MAX_SUNSPOT_GROUPS}];

  // Empirical differential rotation offset (deg/day relative to Carrington frame).
  // Snodgrass & Ulrich (1990): A=14.713, B=-2.396, C=-1.787, omega_C=14.1844.
  float solarDiffDriftTurnsPerDay(float sinLat) {
    float s2 = sinLat * sinLat;
    float driftDeg = 0.5286 - 2.396 * s2 - 1.787 * s2 * s2;
    return driftDeg / 360.0;
  }

  // Evaluate bipolar sunspot darkening (umbra + filamentary penumbra) and surrounding faculae.
  // Returns vec2(darkeningFactor [0..1], faculaeBoost [0..1]).
  vec2 evaluateSolarActiveRegions(vec3 dir) {
    if (uSunspotCount <= 0) return vec2(0.0);
    vec3 p = normalize(dir);
    float dark = 0.0;
    float faculae = 0.0;
    for (int i = 0; i < ${MAX_SUNSPOT_GROUPS}; i++) {
      if (i >= uSunspotCount) break;
      vec3 center = uSunspotPos[i].xyz;
      float radius = uSunspotPos[i].w;
      float strength = uSunspotMeta[i].x;
      if (strength <= 0.005 || radius <= 0.001) continue;
      // Fast angular culling on the unit sphere before tangent-plane projection.
      float cosSep = dot(p, center);
      if (cosSep < 0.85) continue;
      float tilt = uSunspotMeta[i].y;
      float seed = uSunspotMeta[i].z;

      // Local east/north orthonormal tangent basis at the active region center.
      vec3 north = normalize(vec3(0.0, 1.0, 0.0) - center * center.y);
      vec3 east = normalize(cross(north, center));
      vec3 offset = p - center;
      vec2 local = vec2(dot(offset, east), dot(offset, north)) / radius;

      // Apply Joy's Law tilt (leading polarity slightly closer to equator).
      float ct = cos(tilt), st = sin(tilt);
      vec2 rot = vec2(local.x * ct - local.y * st, local.x * st + local.y * ct);

      // Organic distortion from 3D simplex noise in local active-region frame.
      float n1 = snoise(vec3(rot * 2.6 + seed, seed * 0.37));
      float n2 = snoise(vec3(rot * 6.4 - seed, seed * 0.71));

      // Leading spot (stronger, tighter) and trailing spot (slightly more fragmented).
      vec2 qLead = (rot - vec2(0.36, -0.06)) * vec2(1.18, 1.35);
      vec2 qTrail = (rot - vec2(-0.42, 0.10)) * vec2(1.05, 1.28);
      float angLead = atan(qLead.y, qLead.x);
      float angTrail = atan(qTrail.y, qTrail.x);
      float radLead = length(qLead) + n1 * 0.12 + n2 * 0.05;
      float radTrail = length(qTrail) + n1 * 0.16 + n2 * 0.07;

      // Radial penumbral filaments around each umbra.
      float filLead = 0.5 + 0.5 * sin(angLead * 22.0 + n1 * 3.6);
      float filTrail = 0.5 + 0.5 * sin(angTrail * 18.0 - n1 * 3.0);

      float umbraLead = 1.0 - smoothstep(0.22, 0.38, radLead);
      float penLead = (1.0 - smoothstep(0.34, 0.74, radLead)) * (0.46 + 0.30 * filLead);
      float umbraTrail = 1.0 - smoothstep(0.18, 0.34, radTrail);
      float penTrail = (1.0 - smoothstep(0.30, 0.64, radTrail)) * (0.40 + 0.26 * filTrail);

      // Secondary magnetic pores between leading and trailing polarity.
      vec2 qPore = (rot - vec2(-0.04, 0.02)) * vec2(2.0, 2.5);
      float pore = (1.0 - smoothstep(0.24, 0.56, length(qPore) + n2 * 0.24)) * 0.66;

      float spotDark = max(max(umbraLead * 0.95, penLead * 0.64), max(umbraTrail * 0.86, penTrail * 0.54));
      spotDark = max(spotDark, pore * 0.70);
      dark = max(dark, spotDark * strength);

      // Surrounding bright facular network (plage) outside the dark cores.
      float rGroup = length(rot * vec2(0.72, 1.05));
      float facMask = smoothstep(0.36, 0.78, rGroup) * (1.0 - smoothstep(1.18, 2.08, rGroup));
      float facNet = smoothstep(-0.08, 0.62, n1 * 0.65 + n2 * 0.35);
      faculae = max(faculae, facMask * facNet * (1.0 - spotDark) * strength);
    }
    return vec2(clamp(dark, 0.0, 0.95), clamp(faculae, 0.0, 1.0));
  }
`;
