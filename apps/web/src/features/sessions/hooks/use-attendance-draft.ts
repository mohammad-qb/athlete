import { useCallback, useRef, useState } from 'react';
import {
  type AttendanceDraft,
  type DraftScope,
  loadAttendanceDraft,
  saveAttendanceDraft,
} from '@/lib/drafts';

/**
 * One register's draft, read from this device once and written back on every change.
 *
 * The draft on screen is the truth; local storage is its copy. When the copy cannot be
 * written (`stored` is false) the marks still work for as long as the page is open,
 * and the register says they will not survive a reload.
 *
 * The component using this must be keyed by the scope: another user, academy or
 * session is another draft, not this one re-read.
 */
export function useAttendanceDraft(scope: DraftScope) {
  const { userId, academyId, sessionId } = scope;
  const [draft, setDraft] = useState<AttendanceDraft>(() => loadAttendanceDraft(scope));
  const [stored, setStored] = useState(true);
  // The latest draft for the next change to build on: two changes in one tick must not
  // both start from the draft of the last render.
  const latest = useRef(draft);

  const update = useCallback(
    (change: (current: AttendanceDraft) => AttendanceDraft) => {
      const next = change(latest.current);
      if (next === latest.current) return;
      latest.current = next;
      setDraft(next);
      setStored(saveAttendanceDraft({ userId, academyId, sessionId }, next));
    },
    [userId, academyId, sessionId],
  );

  return { draft, stored, update };
}
