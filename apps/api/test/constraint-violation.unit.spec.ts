import { describe, expect, it } from 'vitest';
import { isInvertedRange, violatedConstraint } from '../src/common/db/constraint-violation';

/**
 * PROVES: a database rule the caller broke is recognised wherever the driver's error
 * sits in the cause chain, and nothing else is mistaken for one. This is what turns an
 * overlapping membership from a redacted 500 into a typed 409 (`teams.service.ts`);
 * the HTTP result is asserted in `scripts/smoke.sh`.
 */
describe('violatedConstraint', () => {
  const pgError = Object.assign(new Error('conflicting key value violates exclusion constraint'), {
    code: '23P01',
    constraint: 'team_memberships_no_overlap_same_team',
  });

  it('reads the constraint off the driver error', () => {
    expect(violatedConstraint(pgError)).toBe('team_memberships_no_overlap_same_team');
  });

  it('finds it under the wrappers Drizzle and a service add', () => {
    const wrapped = new Error('Failed query: insert into ...', { cause: pgError });
    expect(violatedConstraint(new Error('outer', { cause: wrapped }))).toBe(
      'team_memberships_no_overlap_same_team',
    );
  });

  it('ignores an error that is not an integrity violation', () => {
    const notIntegrity = Object.assign(new Error('deadlock detected'), {
      code: '40P01',
      constraint: 'whatever',
    });
    expect(violatedConstraint(notIntegrity)).toBeUndefined();
    expect(violatedConstraint(new Error('plain'))).toBeUndefined();
    expect(violatedConstraint('a thrown string')).toBeUndefined();
    expect(violatedConstraint(undefined)).toBeUndefined();
  });

  it('terminates on a self-referential cause', () => {
    const loop = new Error('loop') as Error & { cause?: unknown };
    loop.cause = loop;
    expect(violatedConstraint(loop)).toBeUndefined();
  });
});

describe('isInvertedRange', () => {
  // What Postgres raises when a generated range column is computed from an end before
  // its start: no constraint is named, because none was reached.
  const rangeError = Object.assign(
    new Error('range lower bound must be less than or equal to range upper bound'),
    { code: '22000' },
  );

  it('recognises the range constructor refusing an end before a start, under a wrapper', () => {
    expect(isInvertedRange(new Error('Failed query', { cause: rangeError }))).toBe(true);
    expect(violatedConstraint(rangeError)).toBeUndefined();
  });

  it('is not fooled by another data exception, or by a non-database error code', () => {
    expect(isInvertedRange(Object.assign(new Error('division by zero'), { code: '22012' }))).toBe(false);
    expect(
      isInvertedRange(Object.assign(new Error('range lower bound'), { code: 'ECONNREFUSED' })),
    ).toBe(false);
    expect(isInvertedRange(new Error('range lower bound'))).toBe(false);
  });
});
