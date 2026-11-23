import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAttendanceDraft,
  DRAFT_KEY_PREFIX,
  type DraftScope,
  loadAttendanceDraft,
  markAthlete,
  newClientRecordId,
  saveAttendanceDraft,
} from './drafts';
import { resetSession } from './session-reset';

const SCOPE: DraftScope = { userId: 'user-1', academyId: 'academy-1', sessionId: 'session-1' };
const AMAL = '44444444-4444-4444-4444-444444444444';
const BILAL = '88888888-8888-8888-8888-888888888888';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('attendance drafts', () => {
  it('starts empty, and gives back what was saved: a reload restores the marks', () => {
    expect(loadAttendanceDraft(SCOPE)).toEqual({});

    const draft = markAthlete(markAthlete({}, AMAL, { status: 'late' }), AMAL, { note: 'bus' });
    expect(saveAttendanceDraft(SCOPE, draft)).toBe(true);

    expect(loadAttendanceDraft(SCOPE)).toEqual(draft);
    expect(loadAttendanceDraft(SCOPE)[AMAL]).toMatchObject({ status: 'late', note: 'bus' });
  });

  it('makes an athlete one clientRecordId and keeps it through every later change and reload', () => {
    const first = markAthlete({}, AMAL, { status: 'present' });
    const id = first[AMAL]!.clientRecordId;
    expect(id).toMatch(UUID);

    saveAttendanceDraft(SCOPE, first);
    const reloaded = loadAttendanceDraft(SCOPE);
    const changed = markAthlete(markAthlete(reloaded, AMAL, { status: 'absent' }), AMAL, {
      note: 'ill',
    });

    expect(changed[AMAL]).toEqual({ clientRecordId: id, status: 'absent', note: 'ill' });
  });

  it('gives each athlete an id of their own, and a note alone leaves the status unchosen', () => {
    const draft = markAthlete(markAthlete({}, AMAL, { status: 'present' }), BILAL, { note: 'x' });
    expect(draft[AMAL]!.clientRecordId).not.toBe(draft[BILAL]!.clientRecordId);
    expect(draft[BILAL]!.status).toBeNull();
  });

  it('keeps drafts apart by user, by academy and by session', () => {
    saveAttendanceDraft(SCOPE, markAthlete({}, AMAL, { status: 'present' }));

    expect(loadAttendanceDraft({ ...SCOPE, userId: 'user-2' })).toEqual({});
    expect(loadAttendanceDraft({ ...SCOPE, academyId: 'academy-2' })).toEqual({});
    expect(loadAttendanceDraft({ ...SCOPE, sessionId: 'session-2' })).toEqual({});
  });

  it('is deleted on its own once submitted, and an empty draft leaves nothing stored', () => {
    const other = { ...SCOPE, sessionId: 'session-2' };
    saveAttendanceDraft(SCOPE, markAthlete({}, AMAL, { status: 'present' }));
    saveAttendanceDraft(other, markAthlete({}, AMAL, { status: 'late' }));

    deleteAttendanceDraft(SCOPE);

    expect(loadAttendanceDraft(SCOPE)).toEqual({});
    expect(loadAttendanceDraft(other)[AMAL]?.status).toBe('late');
    expect(window.localStorage.length).toBe(1);
  });

  it('is wiped, with every other draft, by a session reset', () => {
    saveAttendanceDraft(SCOPE, markAthlete({}, AMAL, { status: 'present' }));
    saveAttendanceDraft({ ...SCOPE, sessionId: 'session-2' }, markAthlete({}, BILAL, { status: 'late' }));
    window.localStorage.setItem('sidebar_state', 'true');

    resetSession(new QueryClient());

    expect(loadAttendanceDraft(SCOPE)).toEqual({});
    expect(Object.keys(window.localStorage)).toEqual(['sidebar_state']);
  });

  it('is stored under the prefix a session reset clears', () => {
    saveAttendanceDraft(SCOPE, markAthlete({}, AMAL, { status: 'present' }));
    expect(window.localStorage.key(0)).toBe(
      `${DRAFT_KEY_PREFIX}attendance:user-1:academy-1:session-1`,
    );
  });

  it('treats a stored value that is not a draft as no draft', () => {
    const key = `${DRAFT_KEY_PREFIX}attendance:user-1:academy-1:session-1`;
    window.localStorage.setItem(key, 'not json');
    expect(loadAttendanceDraft(SCOPE)).toEqual({});
    window.localStorage.setItem(key, JSON.stringify({ [AMAL]: { status: 'here' } }));
    expect(loadAttendanceDraft(SCOPE)).toEqual({});
  });

  it('tolerates storage that refuses to be read or written', () => {
    const denied = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);

    expect(loadAttendanceDraft(SCOPE)).toEqual({});
    // Not stored, and says so, without throwing: the marks live on in the page.
    expect(saveAttendanceDraft(SCOPE, markAthlete({}, AMAL, { status: 'present' }))).toBe(false);
    expect(() => deleteAttendanceDraft(SCOPE)).not.toThrow();
  });

  it('still makes a UUID where crypto.randomUUID does not exist (a page not served over HTTPS)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = new Set(Array.from({ length: 20 }, () => newClientRecordId()));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(UUID);
  });
});
