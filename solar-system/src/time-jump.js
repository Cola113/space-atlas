// The timeline's date scrubber: a window of years to drag through, at one day per step.
//
// Two different spans are involved and they are deliberately not the same one.
// The data span is the shipped ephemeris's own coverage and comes from its definition
// (EPHEMERIS_YEARS, 1900-2100): the year field accepts any year in it, and asking for one outside is
// what the two-body anchor fallback exists for. The slider's window is narrower -- a century around
// the years the project actually sends people to -- because 200 years over 380 pixels made every
// pixel worth half a year, which is too coarse to land on a season. A day per step is the finest the
// clock itself distinguishes here, and a step lands on the *start* of that day: anchoring at the
// epoch's own 17:00 instead put anything before it in the previous day, so a date read back from the
// slider was off by one for most of the day.
import { EPHEMERIS_YEARS } from "./physics/ephemeris.js";

export const DATA_FIRST_YEAR = EPHEMERIS_YEARS.first;
export const DATA_LAST_YEAR = EPHEMERIS_YEARS.last;

// 1975 starts next to the date a new session opens at (1971-08-01) and 2075 ends past every seasonal
// event the documents point at: Pluto's 1989 perihelion, Saturn's 2025 and 2040 ring-plane crossings,
// the 2032-2033 ring opening and Uranus's 2049 equinox. Miranda's 2085 high sun falls outside and is
// reached through the year field instead.
export const FIRST_MONTH_YEAR = 1975;
export const LAST_MONTH_YEAR = 2075;
const HOUR_UTC = 0;
const DAY_MS = 86400000;

export const windowStart = Date.UTC(FIRST_MONTH_YEAR, 0, 1, HOUR_UTC);
export const windowEnd = Date.UTC(LAST_MONTH_YEAR, 11, 31, HOUR_UTC);
export const dayCount = Math.round((windowEnd - windowStart) / DAY_MS) + 1;

export const maxMonthIndex = dayCount - 1;

export function clampMonthIndex(index) {
  if (!Number.isFinite(index)) return 0;
  return Math.min(maxMonthIndex, Math.max(0, Math.round(index)));
}

// Indices are days from the window's first day. A date outside the window still has no index of its
// own, so the caller is told rather than left to guess: inside is the index, outside is the nearest
// end plus a flag, and the label can then say the date is outside instead of showing the end date.
export function indexFromDate(date) {
  const time = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(time)) return {index: 0, inside: false};
  const index = Math.floor((time - windowStart) / DAY_MS);
  return {index: clampMonthIndex(index), inside: index >= 0 && index <= maxMonthIndex};
}

export function dateFromIndex(index) {
  return windowStart + clampMonthIndex(index) * DAY_MS;
}

export function indexFromYear(year) {
  const time = Date.UTC(year, 0, 1, HOUR_UTC);
  const index = Math.floor((time - windowStart) / DAY_MS);
  return {index: clampMonthIndex(index), inside: index >= 0 && index <= maxMonthIndex};
}

const pad = value => String(value).padStart(2, "0");

export function dateLabel(index) {
  const date = new Date(dateFromIndex(index));
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}

// The full date with the year, for the case the slider cannot represent: the caller shows this
// instead of a label that would claim the date sits at one end of the window.
export function dateLabelFromDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getUTCFullYear()} 年 ${value.getUTCMonth() + 1} 月 ${pad(value.getUTCDate())} 日`;
}
