import test from 'node:test';
import assert from 'node:assert/strict';
import {EPHEMERIS_YEARS} from '../src/physics/ephemeris.js';
import {DATA_FIRST_YEAR, DATA_LAST_YEAR, FIRST_MONTH_YEAR, LAST_MONTH_YEAR, maxMonthIndex, dayCount,
  clampMonthIndex, indexFromDate, dateFromIndex, indexFromYear, dateLabel, dateLabelFromDate} from '../src/time-jump.js';

test('the slider window sits inside the data span, which stays the only definition of the data', () => {
  assert.equal(DATA_FIRST_YEAR, EPHEMERIS_YEARS.first);
  assert.equal(DATA_LAST_YEAR, EPHEMERIS_YEARS.last);
  assert.ok(FIRST_MONTH_YEAR > DATA_FIRST_YEAR, 'the window starts after the data does');
  assert.ok(LAST_MONTH_YEAR < DATA_LAST_YEAR, 'and ends before it does');
  assert.equal(new Date(dateFromIndex(0)).getUTCFullYear(), FIRST_MONTH_YEAR);
  assert.equal(new Date(dateFromIndex(maxMonthIndex)).getUTCFullYear(), LAST_MONTH_YEAR);
  assert.equal(new Date(dateFromIndex(maxMonthIndex)).getUTCMonth(), 11);
});

test('one step is one day, landing on the start of that day', () => {
  const a = new Date(dateFromIndex(0)), b = new Date(dateFromIndex(1));
  assert.equal((b - a), 86400000);
  assert.equal(a.getUTCHours(), 0);
  // A century of days, give or take the leap ones.
  assert.ok(dayCount > 36524 && dayCount < 36900, `dayCount ${dayCount}`);
});

test('a date inside the window maps both ways', () => {
  for (const iso of ['1975-01-01T00:00:00Z', '1989-08-25T00:00:00Z', '2026-09-16T12:00:00Z', '2075-12-31T23:00:00Z']) {
    const date = new Date(iso);
    const {index, inside} = indexFromDate(date);
    assert.ok(inside, iso);
    const back = new Date(dateFromIndex(index));
    assert.equal(back.getUTCFullYear(), date.getUTCFullYear(), iso);
    assert.equal(back.getUTCMonth(), date.getUTCMonth(), iso);
    assert.equal(back.getUTCDate(), date.getUTCDate(), iso);
  }
});

test('a date outside the window says so instead of pretending to be an end', () => {
  const before = indexFromDate(Date.UTC(1971, 7, 1, 17));
  assert.equal(before.inside, false, 'the default epoch is before the window');
  assert.equal(before.index, 0, 'the thumb still rests at the left end');
  const after = indexFromDate(Date.UTC(2085, 5, 1));
  assert.equal(after.inside, false);
  assert.equal(after.index, maxMonthIndex);
  assert.equal(indexFromDate(Number.NaN).inside, false);
  // The year field reaches the data span, not just the window.
  assert.equal(indexFromYear(1900).inside, false);
  assert.equal(indexFromYear(2085).inside, false);
  assert.equal(indexFromYear(2032).inside, true);
  assert.equal(dateLabelFromDate(Date.UTC(1900, 0, 1)), '1900 年 1 月 01 日');
});

test('the label reads as a full date', () => {
  assert.equal(dateLabel(0), '1975 年 1 月 1 日');
  assert.equal(dateLabel(maxMonthIndex), '2075 年 12 月 31 日');
  const leap = indexFromDate(Date.UTC(2024, 1, 29)).index;
  assert.equal(dateLabel(leap), '2024 年 2 月 29 日', 'a leap day is representable');
  assert.equal(clampMonthIndex(NaN), 0);
  assert.equal(clampMonthIndex(12.6), 13);
});
