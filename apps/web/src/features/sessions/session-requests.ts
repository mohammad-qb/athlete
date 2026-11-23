import { CreateSessionRequest, type SessionListQuery } from '@athlete/contracts';
import { requestValidator } from '@/components/form';
import type { PickerOption } from '@/components/pickers';
import { addDays, atLocalTime, formatDateTime, formatTime, startOfDay, today } from '@/lib/dates';

/** How far back "recent" reaches on the sessions list. */
export const RECENT_DAYS = 14;

/** The sessions list as its URL holds it: the list state, and which sessions to show. */
export interface SessionsSearch {
  page: number;
  pageSize: number;
  sort: SessionListQuery['sort'];
  /** `recent`: upcoming sessions and the last two weeks. `all`: every session. */
  show: 'recent' | 'all';
}

/**
 * The API query for a view of the list. The route's loader and the page both build it
 * here, so the loader prefetches exactly the query the page then reads.
 *
 * "Recent" is a lower bound on the start: everything from the start of the day two
 * weeks ago, which includes whatever is still to come. The bound moves once a day, not
 * once a render, so it is a stable query key.
 */
export function sessionsQuery(
  search: SessionsSearch,
  now: string = today(),
): Partial<SessionListQuery> {
  return {
    page: search.page,
    pageSize: search.pageSize,
    sort: search.sort,
    ...(search.show === 'recent' ? { from: startOfDay(addDays(now, -RECENT_DAYS)) } : {}),
  };
}

/**
 * `Mon 2 Mar 2026, 17:00–18:30`, in the browser's zone. The form makes one-day sessions
 * only, but the API takes any end after the start: a session that ends on another day
 * where the reader is names that day too (`Mon 2 Mar 2026, 23:00–Tue 3 Mar 2026, 01:00`),
 * or its end would read as earlier than its start.
 */
export function formatSessionTime(session: { startsAt: string; endsAt: string }): string {
  const sameDay = today(new Date(session.startsAt)) === today(new Date(session.endsAt));
  const end = sameDay ? formatTime(session.endsAt) : formatDateTime(session.endsAt);
  return `${formatDateTime(session.startsAt)}–${end}`;
}

export interface SessionValues {
  team: PickerOption | null;
  /** A date input and two time inputs: one day, a start and an end on the clock. */
  date: string;
  startTime: string;
  endTime: string;
  /** A text box; empty means no location. */
  location: string;
}

/** The ONLY place the form's values become the request body: what is validated is what is sent. */
export function toSessionRequest(values: SessionValues): CreateSessionRequest {
  return {
    teamId: values.team?.id ?? '',
    startsAt: atLocalTime(values.date, values.startTime),
    endsAt: atLocalTime(values.date, values.endTime),
    location: values.location.trim() || null,
  };
}

const validateRequest = requestValidator<SessionValues>(CreateSessionRequest, toSessionRequest, {
  teamId: 'team',
  startsAt: 'startTime',
  endsAt: 'endTime',
});

/**
 * The form's errors by field, or `undefined` when the request may be sent: the
 * contract's own schema over the request, plus the two things it cannot say. A missing
 * day is reported on the day (the request has no such field: the day is half of each
 * instant), and a session must end after it starts, which the database also insists on.
 */
export function sessionFormErrors(
  values: SessionValues,
): { fields: Record<string, string> } | undefined {
  const fields: Record<string, string> = { ...validateRequest({ value: values })?.fields };
  if (!values.date) {
    fields.date = 'Required.';
    if (values.startTime) delete fields.startTime;
    if (values.endTime) delete fields.endTime;
  }
  if (values.startTime && values.endTime && values.endTime <= values.startTime) {
    fields.endTime ??= 'The session must end after it starts.';
  }
  return Object.keys(fields).length > 0 ? { fields } : undefined;
}
