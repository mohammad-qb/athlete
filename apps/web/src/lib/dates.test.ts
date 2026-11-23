import { describe, expect, it } from 'vitest';
import {
  addDays,
  atLocalTime,
  endOfDay,
  formatDate,
  formatDateTime,
  formatTime,
  startOfDay,
  startOfNextDay,
  today,
} from './dates';

describe('dates', () => {
  it('shows a calendar date as the day it names, whatever the zone', () => {
    expect(formatDate('2008-01-01')).toBe('1 Jan 2008');
  });

  it('shows an instant, and returns what it cannot read unchanged', () => {
    expect(formatDate('2026-03-15T12:00:00Z')).toBe('15 Mar 2026');
    expect(formatDate('soon')).toBe('soon');
  });

  it('gives today as a date input value', () => {
    expect(today(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('turns a day into the instants it starts and ends, in the local zone', () => {
    expect(startOfDay('2026-03-01')).toBe(new Date(2026, 2, 1).toISOString());
    expect(endOfDay('2026-03-01')).toBe(new Date(2026, 2, 1, 23, 59, 59, 999).toISOString());
  });

  it('ends a period at the start of the next day, across a month and a year', () => {
    expect(startOfNextDay('2026-03-01')).toBe(new Date(2026, 2, 2).toISOString());
    expect(startOfNextDay('2026-06-30')).toBe(new Date(2026, 6, 1).toISOString());
    expect(startOfNextDay('2026-12-31')).toBe(new Date(2027, 0, 1).toISOString());
  });

  it('keeps a period that ends on a day inside that day\'s "as of", and touching the next', () => {
    // The API has a period [from, to) on a roster when from <= at < to.
    const periodEnd = startOfNextDay('2026-06-30');
    expect(Date.parse(endOfDay('2026-06-30'))).toBeLessThan(Date.parse(periodEnd));
    expect(Date.parse(endOfDay('2026-07-01'))).toBeGreaterThanOrEqual(Date.parse(periodEnd));
    expect(periodEnd).toBe(startOfDay('2026-07-01'));
  });

  it('leaves anything that is not a calendar date for the schema to refuse', () => {
    expect(startOfDay('')).toBe('');
    expect(endOfDay('March')).toBe('March');
    expect(startOfNextDay('March')).toBe('March');
  });

  it('counts days on the calendar, across a month and a year', () => {
    expect(addDays('2026-03-20', -14)).toBe('2026-03-06');
    expect(addDays('2026-03-05', -14)).toBe('2026-02-19');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('soon', 1)).toBe('soon');
  });

  it('turns a day and a clock time into an instant in the local zone', () => {
    expect(atLocalTime('2026-03-02', '17:05')).toBe(new Date(2026, 2, 2, 17, 5).toISOString());
  });

  it('gives nothing when the day or the time is missing, and passes on what it cannot read', () => {
    expect(atLocalTime('', '17:00')).toBe('');
    expect(atLocalTime('2026-03-02', '')).toBe('');
    expect(atLocalTime('2026-03-02', 'noon')).toBe('2026-03-02Tnoon');
  });

  it('shows an instant as a day and a clock time where the reader is', () => {
    const instant = new Date(2026, 2, 2, 17, 0).toISOString();
    expect(formatDateTime(instant)).toBe('Mon 2 Mar 2026, 17:00');
    expect(formatTime(instant)).toBe('17:00');
    expect(formatDateTime('soon')).toBe('soon');
  });
});
