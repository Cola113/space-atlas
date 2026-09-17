// Jumping the simulation to a month, for the timeline's date scrubber.
//
// The span is the range the shipped ephemeris covers, so the slider cannot ask for a date the app
// has no data for. Months are indexed from 1900-01 and read in UTC, which is how the simulation date
// is kept; the hour is the epoch's own 17:00 UTC so a jump lands on the same time of day the default
// date uses instead of midnight.
// The span is the shipped ephemeris's own, read from its definition rather than written again here.
import { EPHEMERIS_YEARS } from "./physics/ephemeris.js";

export const FIRST_MONTH_YEAR = EPHEMERIS_YEARS.first;
export const LAST_MONTH_YEAR = EPHEMERIS_YEARS.last;
const MONTH_HOUR_UTC = 17;

export const monthCount = (LAST_MONTH_YEAR - FIRST_MONTH_YEAR + 1) * 12;
export const maxMonthIndex = monthCount - 1;

// A date outside the span has no index of its own; the slider shows the nearest end rather than
// refusing to move, and the caller can compare against the real date if it needs to say so.
export function clampMonthIndex(index) {
  if (!Number.isFinite(index)) return 0;
  return Math.min(maxMonthIndex, Math.max(0, Math.round(index)));
}

export function monthIndexFromDate(date) {
  const time = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(time)) return 0;
  const value = new Date(time);
  return clampMonthIndex((value.getUTCFullYear() - FIRST_MONTH_YEAR) * 12 + value.getUTCMonth());
}

export function dateFromMonthIndex(index) {
  const clamped = clampMonthIndex(index);
  return Date.UTC(FIRST_MONTH_YEAR + Math.floor(clamped / 12), clamped % 12, 1, MONTH_HOUR_UTC);
}

export function monthLabel(index) {
  const clamped = clampMonthIndex(index);
  return `${FIRST_MONTH_YEAR + Math.floor(clamped / 12)} 年 ${clamped % 12 + 1} 月`;
}

export const monthIndexOfYear = year => clampMonthIndex((year - FIRST_MONTH_YEAR) * 12);
