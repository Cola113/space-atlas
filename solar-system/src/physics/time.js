import { AstroTime } from 'astronomy-engine';

export const DAY_SECONDS = 86400;
const LEAPS = [
  ['1972-01-01',10],['1972-07-01',11],['1973-01-01',12],['1974-01-01',13],['1975-01-01',14],['1976-01-01',15],['1977-01-01',16],['1978-01-01',17],['1979-01-01',18],['1980-01-01',19],['1981-07-01',20],['1982-07-01',21],['1983-07-01',22],['1985-07-01',23],['1988-01-01',24],['1990-01-01',25],['1991-01-01',26],['1992-07-01',27],['1993-07-01',28],['1994-07-01',29],['1996-01-01',30],['1997-07-01',31],['1999-01-01',32],['2006-01-01',33],['2009-01-01',34],['2012-07-01',35],['2015-07-01',36],['2017-01-01',37],
].map(([date,seconds])=>[Date.parse(date+'T00:00:00Z'),seconds]);
/** Before 1972, the civil date is treated as UT and uses the Delta-T model.
 * Later UTC dates use the published TAI-UTC table. Future leap seconds cannot
 * be predicted, so the table's last value is held until the data is updated.
 * NAIF's small periodic TT→TDB term supplies a common SPK/IAU epoch.
 * Source: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls
 */
export function physicalTime(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('Invalid simulation date');
  const astronomy = new AstroTime(date);
  const leap = LEAPS.findLast(([start]) => date.getTime() >= start);
  // AstroTime exposes date, ut and tt. Keep UTC as the UT1 approximation for
  // Earth rotation, while all dynamical routines receive the same corrected TT.
  if (leap) astronomy.tt = astronomy.ut + (32.184 + leap[1]) / DAY_SECONDS;
  const ttSeconds = astronomy.tt * DAY_SECONDS;
  const meanAnomaly = 6.239996 + 1.99096871e-7 * ttSeconds;
  const tdbSeconds = ttSeconds + .001657 * Math.sin(meanAnomaly + .01671 * Math.sin(meanAnomaly));
  return { date, astronomy, ttSeconds, tdbSeconds, tdbDays: tdbSeconds / DAY_SECONDS,
    timescaleNote: leap
      ? 'UTC 按 NAIF 闰秒表转 TT/TDB；UT1 以 UTC 近似，未来未知闰秒沿用最后已知值。'
      : '1972 年前以 UT 近似民用时间，通过 Astronomy Engine ΔT 估计 TT/TDB，存在历史时标误差。' };
}
