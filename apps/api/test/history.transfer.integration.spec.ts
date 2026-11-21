import { randomUUID } from 'node:crypto';
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
 * PROVES: transferring an athlete does not rewrite the past.
 *
 * This is the brief's core requirement -- "maintaining historical records when athletes
 * or coaches change teams" -- and the test that would catch the most common way of
 * getting it wrong: deriving a historical register from CURRENT membership. Under that
 * design, last month's attendance sheet silently re-attributes itself the moment
 * someone transfers, and nobody notices until an academy disputes a report.
 */
describe('history survives a transfer', () => {
  let db: TestDatabase;
  let academy: Awaited<ReturnType<typeof seedAcademy>>;

  beforeAll(async () => {
    db = await startTestDatabase();
    academy = await seedAcademy(db.pool, 'Fujairah Academy');
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('keeps last month\'s register and roster intact after the athlete moves team', async () => {
    const u17 = await createTeam(db.pool, academy.academyId, 'U17 Squad');
    const firstTeam = await createTeam(db.pool, academy.academyId, 'First Team');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Khalid', 'Mansour');

    // Joined U17 in January.
    await addMembership(db.pool, academy.academyId, u17, athlete, '2026-01-01T00:00:00Z', null);

    // A U17 session in February, with attendance recorded on the day.
    const sessionId = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query(
        `insert into training_sessions (academy_id, team_id, starts_at, ends_at, location)
         values ($1, $2, '2026-02-10T17:00:00Z', '2026-02-10T18:30:00Z', 'Pitch 2')
         returning id`,
        [academy.academyId, u17],
      );
      return rows[0].id as string;
    });

    await asAcademy(db.pool, academy.academyId, (client) =>
      client.query(
        `insert into session_participants
           (academy_id, session_id, athlete_id, team_id_at_time, status, client_record_id, recorded_by_user_id)
         values ($1, $2, $3, $4, 'present', $5, $6)`,
        [academy.academyId, sessionId, athlete, u17, randomUUID(), academy.coachUserId],
      ),
    );

    // --- The transfer: close one period, open another. Nothing is overwritten. ---
    await asAcademy(db.pool, academy.academyId, async (client) => {
      await client.query(
        `update team_memberships set valid_to = '2026-03-01T00:00:00Z'
          where team_id = $1 and athlete_id = $2 and valid_to is null`,
        [u17, athlete],
      );
      await client.query(
        `insert into team_memberships (academy_id, team_id, athlete_id, valid_from)
         values ($1, $2, $3, '2026-03-01T00:00:00Z')`,
        [academy.academyId, firstTeam, athlete],
      );
    });

    // 1. February's register still says the athlete attended, AS A U17 PLAYER.
    const register = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query(
        `select athlete_id, team_id_at_time, status from session_participants where session_id = $1`,
        [sessionId],
      );
      return rows;
    });
    expect(register).toHaveLength(1);
    expect(register[0].athlete_id).toBe(athlete);
    expect(register[0].team_id_at_time).toBe(u17);
    expect(register[0].status).toBe('present');

    // 2. The February U17 roster still contains them; the First Team roster does not.
    const rosterAt = (teamId: string, at: string) =>
      asAcademy(db.pool, academy.academyId, async (client) => {
        const { rows } = await client.query(
          `select athlete_id from team_memberships
            where team_id = $1 and period @> $2::timestamptz`,
          [teamId, at],
        );
        return rows.map((r) => r.athlete_id as string);
      });

    expect(await rosterAt(u17, '2026-02-10T17:00:00Z')).toEqual([athlete]);
    expect(await rosterAt(firstTeam, '2026-02-10T17:00:00Z')).toEqual([]);

    // 3. And today the athlete is a First Team player, not a U17 one.
    expect(await rosterAt(u17, '2026-04-01T00:00:00Z')).toEqual([]);
    expect(await rosterAt(firstTeam, '2026-04-01T00:00:00Z')).toEqual([athlete]);

    // 4. The full membership history is two rows, not one mutated row.
    const history = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query(
        `select team_id, valid_from, valid_to from team_memberships
          where athlete_id = $1 order by valid_from`,
        [athlete],
      );
      return rows;
    });
    expect(history).toHaveLength(2);
    expect(history[0].team_id).toBe(u17);
    expect(history[0].valid_to).not.toBeNull();
    expect(history[1].team_id).toBe(firstTeam);
    expect(history[1].valid_to).toBeNull();
  });

  it('refuses to delete an athlete who has recorded history', async () => {
    // ON DELETE RESTRICT on recorded facts. A register that can be silently emptied by
    // deleting a parent row is not a historical record.
    const team = await createTeam(db.pool, academy.academyId, 'Deletion Test XI');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Record', 'Keeper');
    await addMembership(db.pool, academy.academyId, team, athlete, '2026-01-01T00:00:00Z', null);

    const sessionId = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query(
        `insert into training_sessions (academy_id, team_id, starts_at, ends_at)
         values ($1, $2, '2026-02-01T10:00:00Z', '2026-02-01T11:00:00Z') returning id`,
        [academy.academyId, team],
      );
      return rows[0].id as string;
    });
    await asAcademy(db.pool, academy.academyId, (client) =>
      client.query(
        `insert into session_participants
           (academy_id, session_id, athlete_id, team_id_at_time, status, client_record_id, recorded_by_user_id)
         values ($1, $2, $3, $4, 'present', $5, $6)`,
        [academy.academyId, sessionId, athlete, team, randomUUID(), academy.coachUserId],
      ),
    );

    await expect(
      asAcademy(db.pool, academy.academyId, (client) =>
        client.query('delete from athletes where id = $1', [athlete]),
      ),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it('replays an offline attendance submission without duplicating it', async () => {
    // Same client_record_id arriving twice -- a phone retrying after a dropped
    // connection. The idempotency key makes the second insert a no-op rather than a
    // duplicate register entry.
    const team = await createTeam(db.pool, academy.academyId, 'Offline Test XI');
    const athlete = await createAthlete(db.pool, academy.academyId, 'Retry', 'Case');
    await addMembership(db.pool, academy.academyId, team, athlete, '2026-01-01T00:00:00Z', null);

    const sessionId = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query(
        `insert into training_sessions (academy_id, team_id, starts_at, ends_at)
         values ($1, $2, '2026-02-02T10:00:00Z', '2026-02-02T11:00:00Z') returning id`,
        [academy.academyId, team],
      );
      return rows[0].id as string;
    });

    const clientRecordId = randomUUID();
    const submit = () =>
      asAcademy(db.pool, academy.academyId, (client) =>
        client.query(
          `insert into session_participants
             (academy_id, session_id, athlete_id, team_id_at_time, status, client_record_id, recorded_by_user_id)
           values ($1, $2, $3, $4, 'present', $5, $6)
           on conflict (academy_id, client_record_id) do nothing`,
          [academy.academyId, sessionId, athlete, team, clientRecordId, academy.coachUserId],
        ),
      );

    const first = await submit();
    const second = await submit();
    expect(first.rowCount).toBe(1);
    expect(second.rowCount).toBe(0);

    const count = await asAcademy(db.pool, academy.academyId, async (client) => {
      const { rows } = await client.query(
        'select count(*)::int as n from session_participants where session_id = $1',
        [sessionId],
      );
      return rows[0].n as number;
    });
    expect(count).toBe(1);
  });
});
