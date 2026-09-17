import test from 'node:test';
import assert from 'node:assert/strict';
import {EPHEMERIS_YEARS} from '../src/physics/ephemeris.js';
import {FIRST_MONTH_YEAR, LAST_MONTH_YEAR, maxMonthIndex, clampMonthIndex, monthIndexFromDate,
  dateFromMonthIndex, monthLabel, monthIndexOfYear} from '../src/time-jump.js';

test('month indices span the years the ephemeris covers', () => {
  assert.equal(maxMonthIndex, (LAST_MONTH_YEAR - FIRST_MONTH_YEAR + 1) * 12 - 1);
  assert.equal(monthIndexOfYear(1900), 0);
  assert.equal(monthIndexOfYear(2100), maxMonthIndex - 11);
  // The end of the span is December 2100, not the start of 2101.
  assert.equal(new Date(dateFromMonthIndex(maxMonthIndex)).getUTCFullYear(), 2100);
  assert.equal(new Date(dateFromMonthIndex(maxMonthIndex)).getUTCMonth(), 11);
});

test('the span is the ephemeris span, not a second copy of it', () => {
  assert.equal(FIRST_MONTH_YEAR, EPHEMERIS_YEARS.first);
  assert.equal(LAST_MONTH_YEAR, EPHEMERIS_YEARS.last);
  assert.equal(maxMonthIndex, (EPHEMERIS_YEARS.last - EPHEMERIS_YEARS.first + 1) * 12 - 1);
});

test('a month index and a date round-trip', () => {
  for (const iso of ['1900-01-15T00:00:00Z', '1971-08-01T17:00:00Z', '2026-09-16T12:00:00Z', '2100-12-31T23:59:59Z']) {
    const date = new Date(iso);
    const back = new Date(dateFromMonthIndex(monthIndexFromDate(date)));
    assert.equal(back.getUTCFullYear(), date.getUTCFullYear(), iso);
    assert.equal(back.getUTCMonth(), date.getUTCMonth(), iso);
  }
  // The default epoch's own time of day is kept, so a jump does not shift the hour.
  assert.equal(new Date(dateFromMonthIndex(monthIndexFromDate(Date.UTC(1971, 7, 1, 17)))).getUTCHours(), 17);
});

test('dates outside the span clamp to their nearest end, and junk does not move it', () => {
  assert.equal(monthIndexFromDate(Date.UTC(1899, 11, 31)), 0);
  assert.equal(monthIndexFromDate(Date.UTC(2200, 0, 1)), maxMonthIndex);
  assert.equal(clampMonthIndex(-5), 0);
  assert.equal(clampMonthIndex(maxMonthIndex + 40), maxMonthIndex);
  assert.equal(clampMonthIndex(NaN), 0);
  assert.equal(clampMonthIndex(12.6), 13);
  assert.equal(new Date(dateFromMonthIndex(Number.NaN)).getUTCFullYear(), FIRST_MONTH_YEAR);
});

test('the label reads as a month, one-based', () => {
  assert.equal(monthLabel(0), '1900 年 1 月');
  assert.equal(monthLabel(monthIndexOfYear(2032)), '2032 年 1 月');
  assert.equal(monthLabel(monthIndexOfYear(2032) + 11), '2032 年 12 月');
  assert.equal(monthLabel(maxMonthIndex), '2100 年 12 月');
});
