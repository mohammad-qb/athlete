import type { AttendanceStatus, RecordAttendanceRequest } from '@athlete/contracts';
import type { ParticipationResponse, RosterEntry } from '@/lib/api';
import type { AttendanceDraft, AttendanceMark } from '@/lib/drafts';

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

/** The order the choices are offered in: the common answer first. */
export const STATUSES: readonly AttendanceStatus[] = ['present', 'late', 'absent', 'excused'];

/** An athlete whose attendance the API already holds. Read-only: voiding has no route. */
export interface RecordedRow {
  athleteId: string;
  fullName: string;
  status: AttendanceStatus;
  note: string | null;
}

/** An athlete on the roster with nothing recorded yet, and what the coach has entered so far. */
export interface PendingRow {
  athleteId: string;
  fullName: string;
  mark: AttendanceMark | undefined;
}

export interface Register {
  recorded: RecordedRow[];
  pending: PendingRow[];
  /** How many of `pending` have a status chosen. */
  marked: number;
  /** Everyone still to record has a status: the register can be submitted. */
  complete: boolean;
}

/**
 * One session's register as the screen shows it, from the three things it is made of:
 * the roster as of the session's start (who should be on it), the entries the API
 * holds (who is recorded), and the local draft (what has been marked but not sent).
 *
 * An athlete is EITHER recorded OR pending, decided by the server's entries alone: a
 * draft mark for someone already recorded is ignored, so nothing recorded can be sent
 * a second time under a new id.
 */
export function buildRegister(
  roster: readonly RosterEntry[],
  entries: readonly ParticipationResponse[],
  draft: AttendanceDraft,
): Register {
  const names = new Map(roster.map((athlete) => [athlete.athleteId, athlete.fullName]));
  const entryOf = new Map(entries.map((entry) => [entry.athleteId, entry]));

  const toRecorded = (entry: ParticipationResponse): RecordedRow => ({
    athleteId: entry.athleteId,
    // Recorded, but not on the roster this user may read as of the start.
    fullName: names.get(entry.athleteId) ?? 'Athlete not on this roster',
    status: entry.status,
    note: entry.note,
  });

  const recorded: RecordedRow[] = [];
  const pending: PendingRow[] = [];
  // Roster order first (the API's, by name), so a row does not move when it is recorded.
  for (const athlete of roster) {
    const entry = entryOf.get(athlete.athleteId);
    if (entry) recorded.push(toRecorded(entry));
    else pending.push({ ...athlete, mark: draft[athlete.athleteId] });
  }
  for (const entry of entries) {
    if (!names.has(entry.athleteId)) recorded.push(toRecorded(entry));
  }

  const marked = pending.filter((row) => row.mark?.status != null).length;
  return { recorded, pending, marked, complete: pending.length > 0 && marked === pending.length };
}

/**
 * What submitting sends: one entry per marked pending athlete, each under the
 * `clientRecordId` its mark has carried since it was first made. Sending it again,
 * after a failure or a reload, therefore sends the same ids, and the API stores
 * nothing twice.
 */
export function toAttendanceRequest(pending: readonly PendingRow[]): RecordAttendanceRequest {
  return {
    entries: pending.flatMap((row) =>
      row.mark?.status
        ? [
            {
              clientRecordId: row.mark.clientRecordId,
              athleteId: row.athleteId,
              status: row.mark.status,
              note: row.mark.note.trim() || null,
            },
          ]
        : [],
    ),
  };
}

/** The draft without the athletes the API now holds: marks that can never be sent again. */
export function withoutRecorded(
  draft: AttendanceDraft,
  entries: readonly ParticipationResponse[],
): AttendanceDraft {
  const recorded = new Set(entries.map((entry) => entry.athleteId));
  return Object.fromEntries(Object.entries(draft).filter(([athleteId]) => !recorded.has(athleteId)));
}

/** The register after a submission: what was there, plus what the API answered with. */
export function mergeEntries(
  existing: readonly ParticipationResponse[] | undefined,
  answered: readonly ParticipationResponse[],
): ParticipationResponse[] {
  const byId = new Map((existing ?? []).map((entry) => [entry.id, entry]));
  for (const entry of answered) byId.set(entry.id, entry);
  return [...byId.values()];
}
