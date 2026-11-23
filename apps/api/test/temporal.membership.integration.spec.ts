import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMembership,
  asAcademy,
  createAthlete,
  createTeam,
  seedAcademy,
  startTestDatabase,
  type TestDatabase,
} from './support/harness';

/**
 * PROVES: the temporal model admits what the domain allows and rejects what it does not.
 *
 * The constraint scope is deliberate and worth defending: an athlete MAY be in several
 * teams at once (a U17 squad and the first team, football and athletics). What is
 * forbidden is an overlapping or duplicate period for the SAME athlete in the SAME
 * team. A blanket "one team at a time" constraint would have been simpler to show off
 * and wrong for real academies.
 */
describe('temporal team membership', () => {
  let db: TestDatabase;
  let academy: Awaited<ReturnType<typeof seedAcademy>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    academy = await seedAcademy(db, 'Al Ain Youth Academy');
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('rejects overlapping periods for the same athlete in the same team', async () => {
    const team = await createTeam(db.pool, academy.academyId, 'U17 Squad');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Yousef', 'Karim');

    await addMembership(
      db.pool,
      academy.academyId,
      team,
      athlete,
      '2026-01-01T00:00:00Z',
      '2026-06-30T00:00:00Z',
    );

    // Overlaps the existing period by one month -> refused by the database itself.
    await expect(
      addMembership(
        db.pool,
        academy.academyId,
        team,
        athlete,
        '2026-06-01T00:00:00Z',
        '2026-12-31T00:00:00Z',
      ),
    ).rejects.toThrow(/team_memberships_no_overlap_same_team|conflicting key value/i);
  });

  it('rejects a duplicate open-ended membership in the same team', async () => {
    const team = await createTeam(db.pool, academy.academyId, 'First Team');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Rashid', 'Noor');

    await addMembership(db.pool, academy.academyId, team, athlete, '2026-01-01T00:00:00Z', null);

    await expect(
      addMembership(db.pool, academy.academyId, team, athlete, '2026-03-01T00:00:00Z', null),
    ).rejects.toThrow(/team_memberships_no_overlap_same_team|conflicting key value/i);
  });

  it('ALLOWS concurrent membership of two different teams', async () => {
    const u17 = await createTeam(db.pool, academy.academyId, 'U17 Football', 'football', 'U17');
    const athletics = await createTeam(db.pool, academy.academyId, 'Sprint Squad', 'athletics');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Maryam', 'Zayed');

    await addMembership(db.pool, academy.academyId, u17, athlete, '2026-01-01T00:00:00Z', null);
    // Same athlete, same instant, different team -> legitimate, and must not be blocked.
    await expect(
      addMembership(db.pool, academy.academyId, athletics, athlete, '2026-01-01T00:00:00Z', null),
    ).resolves.toBeTypeOf('string');
  });

  it('accepts back-to-back periods that touch but do not overlap', async () => {
    // The period is built as '[)' -- inclusive start, exclusive end -- so a leaver and
    // a rejoiner on the same timestamp is a legal, gapless history.
    const team = await createTeam(db.pool, academy.academyId, 'Reserves');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Hamad', 'Juma');

    await addMembership(
      db.pool,
      academy.academyId,
      team,
      athlete,
      '2026-01-01T00:00:00Z',
      '2026-07-01T00:00:00Z',
    );
    await expect(
      addMembership(db.pool, academy.academyId, team, athlete, '2026-07-01T00:00:00Z', null),
    ).resolves.toBeTypeOf('string');
  });

  it('rejects a period that ends before it starts', async () => {
    // Note which mechanism fires: the generated tstzrange column is computed first, and
    // the range constructor itself refuses an inverted bound ("range lower bound must be
    // less than or equal to range upper bound"), so the CHECK constraint never runs.
    // Either way the row cannot exist -- two independent defences, one assertion.
    const team = await createTeam(db.pool, academy.academyId, 'U15 Squad');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Saeed', 'Ali');
    await expect(
      addMembership(
        db.pool,
        academy.academyId,
        team,
        athlete,
        '2026-06-01T00:00:00Z',
        '2026-01-01T00:00:00Z',
      ),
    ).rejects.toThrow(
      /team_memberships_period_valid|violates check constraint|range lower bound must be less than/i,
    );
  });

  it('answers "who was on this team then" from the period, not a current-team column', async () => {
    const team = await createTeam(db.pool, academy.academyId, 'Historic XI');
    const leaver = await createAthlete(db.pool, academy.academyId, 'Past', 'Player');
    const joiner = await createAthlete(db.pool, academy.academyId, 'New', 'Player');

    await addMembership(
      db.pool,
      academy.academyId,
      team,
      leaver,
      '2026-01-01T00:00:00Z',
      '2026-05-01T00:00:00Z',
    );
    await addMembership(db.pool, academy.academyId, team, joiner, '2026-05-01T00:00:00Z', null);

    const rosterAt = (at: string) =>
      asAcademy(db.pool, academy.academyId, async (client) => {
        const { rows } = await client.query(
          `select a.first_name
             from team_memberships m
             join athletes a
               on a.id = m.athlete_id and a.academy_id = m.academy_id
            where m.team_id = $1
              and m.period @> $2::timestamptz
            order by a.first_name`,
          [team, at],
        );
        return rows.map((r) => r.first_name as string);
      });

    // March: only the leaver was there. The generated tstzrange plus the containment
    // operator answer this directly -- no snapshot table, no event replay.
    expect(await rosterAt('2026-03-01T00:00:00Z')).toEqual(['Past']);
    // July: only the joiner. The same query, a different instant.
    expect(await rosterAt('2026-07-01T00:00:00Z')).toEqual(['New']);
  });
});
