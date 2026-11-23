import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrincipalScopeRepository } from '../src/common/authz/principal-scope.repository';
import type { Principal } from '../src/common/authz/principal';
import { DatabaseService } from '../src/common/tenancy/database.service';
import {
  addMembership,
  assignCoach,
  createAthlete,
  createTeam,
  seedAcademy,
  startTestDatabase,
  type SeededAcademy,
  type TestDatabase,
} from './support/harness';

/**
 * PROVES: a principal's scope follows the PERIODS in the data, as at one instant.
 *
 * Every conditional rule in the policy reads these two id sets, so they are the whole
 * of "responsibilities": a closed assignment must contribute no team, and an athlete
 * who has left must drop out, with nothing but the dates deciding it.
 */
describe('principal scope resolution', () => {
  let db: TestDatabase;
  let database: DatabaseService;
  let academy: SeededAcademy;
  let other: SeededAcademy;
  const scopes = new PrincipalScopeRepository();

  let current: string;
  let former: string;
  let onCurrent: string;
  let leftCurrent: string;
  let onFormer: string;

  const coach = (): Principal => ({
    userId: academy.coachUserId,
    academyId: academy.academyId,
    roles: ['coach'],
  });

  const resolveAt = (principal: Principal, asOf: string) =>
    database.runInTenantTransaction(principal.academyId, (tx) =>
      scopes.resolve(tx, principal, new Date(asOf)),
    );

  beforeAll(async () => {
    db = await startTestDatabase();
    database = new DatabaseService(db.url, 2);
    academy = await seedAcademy(db, 'Scope Academy');
    other = await seedAcademy(db, 'Other Academy');

    current = await createTeam(db.pool, academy.academyId, 'Current Team');
    former = await createTeam(db.pool, academy.academyId, 'Former Team');
    onCurrent = await createAthlete(db.pool, academy.academyId, 'On', 'Current');
    leftCurrent = await createAthlete(db.pool, academy.academyId, 'Left', 'Current');
    onFormer = await createAthlete(db.pool, academy.academyId, 'On', 'Former');

    // Open assignment on one team; an assignment that closed on 1 March on the other.
    await assignCoach(db.pool, academy.academyId, current, academy.coachUserId, '2026-01-01T00:00:00Z');
    await assignCoach(
      db.pool,
      academy.academyId,
      former,
      academy.coachUserId,
      '2026-01-01T00:00:00Z',
      '2026-03-01T00:00:00Z',
    );

    await addMembership(db.pool, academy.academyId, current, onCurrent, '2026-01-01T00:00:00Z');
    await addMembership(
      db.pool,
      academy.academyId,
      current,
      leftCurrent,
      '2026-01-01T00:00:00Z',
      '2026-04-01T00:00:00Z',
    );
    await addMembership(db.pool, academy.academyId, former, onFormer, '2026-01-01T00:00:00Z');

    // The same coach user also coaches a team in ANOTHER academy.
    const elsewhere = await createTeam(db.pool, other.academyId, 'Elsewhere');
    await assignCoach(db.pool, other.academyId, elsewhere, academy.coachUserId, '2026-01-01T00:00:00Z');
  }, 180_000);

  afterAll(async () => {
    await database?.onModuleDestroy();
    await db?.stop();
  });

  it('while both assignments are open, both teams and all their athletes are in scope', async () => {
    const scope = await resolveAt(coach(), '2026-02-01T00:00:00Z');
    expect(scope.activeTeamIds.sort()).toEqual([current, former].sort());
    expect(scope.visibleAthleteIds.sort()).toEqual([onCurrent, leftCurrent, onFormer].sort());
  });

  it('a closed assignment contributes no team and none of its athletes', async () => {
    const scope = await resolveAt(coach(), '2026-03-15T00:00:00Z');
    expect(scope.activeTeamIds).toEqual([current]);
    expect(scope.visibleAthleteIds.sort()).toEqual([onCurrent, leftCurrent].sort());
  });

  it('the period is half-open: an assignment ending at exactly asOf is already over', async () => {
    const scope = await resolveAt(coach(), '2026-03-01T00:00:00Z');
    expect(scope.activeTeamIds).toEqual([current]);
  });

  it('an athlete whose membership has ended drops out of scope', async () => {
    const scope = await resolveAt(coach(), '2026-05-01T00:00:00Z');
    expect(scope.visibleAthleteIds).toEqual([onCurrent]);
  });

  it('before any assignment began, the scope is empty', async () => {
    const scope = await resolveAt(coach(), '2025-12-01T00:00:00Z');
    expect(scope.activeTeamIds).toEqual([]);
    expect(scope.visibleAthleteIds).toEqual([]);
  });

  it('carries the instant it was resolved for', async () => {
    const scope = await resolveAt(coach(), '2026-02-01T00:00:00Z');
    expect(scope.asOf.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('the tenant transaction supplies the database transaction time, not the host clock', async () => {
    const { scope, now } = await database.runInTenantTransaction(academy.academyId, async (tx, startedAt) => {
      const resolved = await scopes.resolve(tx, coach(), startedAt);
      const { rows } = await tx.execute<{ now: string }>(
        sql`select to_char(date_trunc('milliseconds', now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`,
      );
      return { scope: resolved, now: rows[0]?.now };
    });
    // now() is fixed for the transaction, so the two reads are the same instant exactly.
    expect(scope.asOf.toISOString()).toBe(now);
    expect(scope.activeTeamIds).toEqual([current]);
  });

  it('never reaches into another academy, even for the same user', async () => {
    const scope = await resolveAt(coach(), '2026-02-01T00:00:00Z');
    expect(scope.activeTeamIds).toHaveLength(2);

    const elsewhere = await resolveAt({ ...coach(), academyId: other.academyId }, '2026-02-01T00:00:00Z');
    expect(elsewhere.activeTeamIds).toHaveLength(1);
    expect(elsewhere.activeTeamIds).not.toContain(current);
    expect(elsewhere.visibleAthleteIds).toEqual([]);
  });

  it('an administrator resolves no sets: their grants carry no conditions', async () => {
    const scope = await resolveAt(
      { userId: academy.adminUserId, academyId: academy.academyId, roles: ['academy_admin'] },
      '2026-02-01T00:00:00Z',
    );
    expect(scope.activeTeamIds).toEqual([]);
    expect(scope.visibleAthleteIds).toEqual([]);
  });
});
