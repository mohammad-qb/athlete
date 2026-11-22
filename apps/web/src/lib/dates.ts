/**
 * Dates as the screens show and send them.
 *
 * Two kinds exist in the API and they must not be confused. A CALENDAR DATE
 * (`YYYY-MM-DD`, a date of birth) names a day and has no time zone. An INSTANT (an
 * ISO-8601 date-time with an offset: a membership's start, a roster's `at`) is a point
 * in time. A date input produces the first kind; where the API wants the second, the
 * day is read in the browser's own zone, because "from the 3rd" means the 3rd where the
 * person is sitting.
 */
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date or an instant, as text. A calendar date is shown as the day it names. */
export function formatDate(date: string): string {
  const parsed = new Date(CALENDAR_DATE.test(date) ? `${date}T00:00:00Z` : date);
  return Number.isNaN(parsed.getTime()) ? date : dateFormat.format(parsed);
}

/** Today in the browser's zone, as a date input's value. */
export function today(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

type DayBoundary = 'start' | 'end' | 'nextStart';

function localDay(date: string, boundary: DayBoundary): string {
  const match = CALENDAR_DATE.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  // The next day is asked of the calendar (day + 1 rolls over a month or a year), not
  // added as 24 hours: a day on which the clocks change is 23 or 25 hours long.
  const first = boundary === 'nextStart' ? Number(day) + 1 : Number(day);
  const instant =
    boundary === 'end'
      ? new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999)
      : new Date(Number(year), Number(month) - 1, first);
  return Number.isNaN(instant.getTime()) ? date : instant.toISOString();
}

/**
 * The instant a day starts, in the browser's zone: what "from this date" means.
 * Anything that is not a calendar date is returned as it came, for the schema to refuse.
 */
export function startOfDay(date: string): string {
  return localDay(date, 'start');
}

/**
 * The last instant INSIDE a day, in the browser's zone: what "as of this date" means.
 * It is a point to ask about, never the end of a period: see `startOfNextDay`.
 */
export function endOfDay(date: string): string {
  return localDay(date, 'end');
}

/**
 * The instant the following day starts, in the browser's zone: what "until the end of
 * this date" means for a period. The API's periods exclude their end (`[from, to)`), so
 * a period whose last day is this one ends HERE. Ending it at `endOfDay` would leave it
 * out of the "as of" answer for its own last day, and a millisecond short of a period
 * that starts the next day.
 */
export function startOfNextDay(date: string): string {
  return localDay(date, 'nextStart');
}
