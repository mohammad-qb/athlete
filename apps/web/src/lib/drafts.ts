import { AttendanceStatus } from '@athlete/contracts';
import { z } from 'zod';

/**
 * Every draft kept in local storage lives under this prefix, so "all drafts" is a
 * definition and not a list to maintain: `clearDrafts` removes whatever starts with it.
 */
export const DRAFT_KEY_PREFIX = 'athlete:draft:';

/** Whose draft, of which register. All three, so no draft is ever read by someone else. */
export interface DraftScope {
  userId: string;
  academyId: string;
  sessionId: string;
}

/**
 * What a coach has entered for one athlete and not yet submitted.
 *
 * `clientRecordId` is made ONCE, when the athlete is first touched, and kept with the
 * mark from then on. It is what the API deduplicates on, so every attempt to submit
 * this mark (a retry after a failure, a submit after a reload) must carry the same one.
 */
const AttendanceMark = z.object({
  clientRecordId: z.guid(),
  /** Null while only a note has been typed. */
  status: AttendanceStatus.nullable(),
  note: z.string(),
});
export type AttendanceMark = z.infer<typeof AttendanceMark>;

/** One register's unsubmitted marks, by athlete id. */
const AttendanceDraft = z.record(z.string(), AttendanceMark);
export type AttendanceDraft = z.infer<typeof AttendanceDraft>;

function keyOf(scope: DraftScope): string {
  return `${DRAFT_KEY_PREFIX}attendance:${scope.userId}:${scope.academyId}:${scope.sessionId}`;
}

/**
 * A v4 UUID. `crypto.randomUUID` exists only in a secure context (HTTPS or localhost);
 * a phone on a development machine's LAN address is not one, and `getRandomValues` is
 * available there.
 */
export function newClientRecordId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The draft with one athlete's mark changed. Pure: the caller stores the result.
 *
 * The athlete's `clientRecordId` is created here the first time they are touched and
 * never replaced afterwards, whatever else about the mark changes.
 */
export function markAthlete(
  draft: AttendanceDraft,
  athleteId: string,
  change: Partial<Pick<AttendanceMark, 'status' | 'note'>>,
  newId: () => string = newClientRecordId,
): AttendanceDraft {
  const existing = draft[athleteId];
  return {
    ...draft,
    [athleteId]: {
      clientRecordId: existing?.clientRecordId ?? newId(),
      status: existing?.status ?? null,
      note: existing?.note ?? '',
      ...change,
    },
  };
}

/**
 * The stored draft of a register, or an empty one.
 *
 * Storage that cannot be read (private mode, a blocked site) and a stored value that is
 * not a draft are both "no draft": the register still works, it just starts unmarked.
 */
export function loadAttendanceDraft(scope: DraftScope): AttendanceDraft {
  try {
    const stored = window.localStorage.getItem(keyOf(scope));
    if (stored === null) return {};
    const parsed = AttendanceDraft.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Stores the draft; an empty one is removed. Returns whether it is now on this device:
 * when storage refuses (full, or unavailable) the marks live on in the page only, and
 * the register says so instead of failing.
 */
export function saveAttendanceDraft(scope: DraftScope, draft: AttendanceDraft): boolean {
  try {
    if (Object.keys(draft).length === 0) window.localStorage.removeItem(keyOf(scope));
    else window.localStorage.setItem(keyOf(scope), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** Forgets one register's draft: it has been submitted. */
export function deleteAttendanceDraft(scope: DraftScope): void {
  saveAttendanceDraft(scope, {});
}

/**
 * Forgets every draft on this device, whoever's it was. Called by `resetSession`
 * (sign-out, academy switch, a 401).
 */
export function clearDrafts(): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode, a blocked cookie jar). There is then
    // no draft to clear, and a reset must never fail on its way to sign-in.
  }
}
