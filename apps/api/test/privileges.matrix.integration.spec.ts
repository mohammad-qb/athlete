import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrincipalScopeRepository } from '../src/common/authz/principal-scope.repository';
import { assertDatabasePrivileges } from '../src/common/tenancy/database-privileges';
import { DatabaseService } from '../src/common/tenancy/database.service';
import {
  asAcademy,
  daysAgo,
  seedTwoTeamAcademy,
  startTestDatabase,
  type TestDatabase,
  type TwoTeamAcademy,
} from './support/harness';

/**
 * PROVES: the database refuses what the application should never ask for.
 *
 * Tenant isolation says which academy's rows a statement can touch. This says which
 * STATEMENTS the application role can issue at all: it cannot delete a recorded fact,
 * edit one in place, mint a role grant, or reach a table nobody granted it. The
 * application layer agrees with all of this -- the point is that it no longer has to
 * be right for the guarantee to hold.
 *
 * Every refusal is asserted as the application role, inside its own tenant: RLS would
 * allow each of these rows, so what stops the statement is the privilege, not the policy.
 */
describe('database privilege matrix', () => {
  let db: TestDatabase;
  let academy: TwoTeamAcademy;
  let sessionId: string;
  let participantId: string;

  const inTenant = <T>(fn: Parameters<typeof asAcademy<T>>[2]) =>
    asAcademy(db.pool, academy.academyId, fn);

  const insertParticipant = (status: string) =>
    inTenant(async (client) => {
      const { rows } = await client.query(
        `insert into session_participants
           (academy_id, session_id, athlete_id, team_id_at_time, status, client_record_id, recorded_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          academy.academyId,
          sessionId,
          academy.athleteOnA,
          academy.teamA,
          status,
          randomUUID(),
          academy.coachUserId,
        ],
      );
      return rows[0].id as string;
    });

  beforeAll(async () => {
    db = await startTestDatabase();
    academy = await seedTwoTeamAcademy(db, 'Privileges Academy');

    sessionId = await inTenant(async (client) => {
      const { rows } = await client.query(
        `insert into training_sessions (academy_id, team_id, starts_at, ends_at)
         values ($1, $2, $3, $4) returning id`,
        [academy.academyId, academy.teamA, daysAgo(3), daysAgo(2)],
      );
      return rows[0].id as string;
    });
    participantId = await insertParticipant('present');
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  describe('recorded facts', () => {
    it.each(['session_participants', 'team_memberships', 'assessments'])(
      'cannot be deleted: %s',
      async (table) => {
        await expect(
          inTenant((client) => client.query(`delete from ${table}`)),
        ).rejects.toThrow(new RegExp(`permission denied for table ${table}`, 'i'));
      },
    );

    it('cannot be edited in place: only the voiding columns are writable', async () => {
      await expect(
        inTenant((client) =>
          client.query(`update session_participants set status = 'absent' where id = $1`, [
            participantId,
          ]),
        ),
      ).rejects.toThrow(/permission denied for table session_participants/i);

      await expect(
        inTenant((client) =>
          client.query(`update team_memberships set team_id = $1`, [academy.teamB]),
        ),
      ).rejects.toThrow(/permission denied for table team_memberships/i);
    });

    it('cannot be removed through a parent, by the application or by the owner', async () => {
      // The application role cannot delete a parent of facts at all...
      await expect(
        inTenant((client) =>
          client.query('delete from training_sessions where id = $1', [sessionId]),
        ),
      ).rejects.toThrow(/permission denied for table training_sessions/i);

      // ...and a role that CAN is stopped by the foreign key. Both of these parents
      // cascaded before 0002: deleting the session emptied its register, deleting the
      // team erased its membership history.
      await expect(
        db.adminPool.query('delete from training_sessions where id = $1', [sessionId]),
      ).rejects.toThrow(/session_participants_session_fk/);
      await expect(
        db.adminPool.query('delete from teams where id = $1', [academy.teamB]),
      ).rejects.toThrow(/team_memberships_team_fk/);

      const { rows } = await db.adminPool.query(
        'select count(*)::int as n from session_participants where session_id = $1',
        [sessionId],
      );
      expect(rows[0].n).toBeGreaterThan(0);
    });

    it('a void must be attributed: voided_at without voided_by is rejected', async () => {
      await expect(
        inTenant((client) =>
          client.query(`update session_participants set voided_at = now() where id = $1`, [
            participantId,
          ]),
        ),
      ).rejects.toThrow(/session_participants_void_attributed/);
    });
  });

  describe('correction is void + re-insert', () => {
    it('replaces a wrong register entry and keeps the wrong one on record', async () => {
      // While the original is active, a second entry for the same athlete and session
      // is refused -- this is the rule that made correction impossible when it was an
      // unconditional constraint.
      await expect(insertParticipant('absent')).rejects.toThrow(
        /session_participants_once_per_session/,
      );

      await inTenant((client) =>
        client.query(
          `update session_participants set voided_at = now(), voided_by = $2 where id = $1`,
          [participantId, academy.adminUserId],
        ),
      );
      const replacementId = await insertParticipant('absent');

      const rows = await inTenant(async (client) => {
        const result = await client.query(
          `select id, status, voided_at is not null as voided
             from session_participants
            where session_id = $1 and athlete_id = $2
            order by recorded_at`,
          [sessionId, academy.athleteOnA],
        );
        return result.rows;
      });
      expect(rows).toEqual([
        { id: participantId, status: 'present', voided: true },
        { id: replacementId, status: 'absent', voided: false },
      ]);
    });

    it('a voided membership stops occupying its period', async () => {
      const overlapping = () =>
        inTenant(async (client) => {
          const { rows } = await client.query(
            `insert into team_memberships (academy_id, team_id, athlete_id, valid_from)
             values ($1, $2, $3, $4) returning id`,
            [academy.academyId, academy.teamB, academy.athleteOnB, daysAgo(30)],
          );
          return rows[0].id as string;
        });

      await expect(overlapping()).rejects.toThrow(/team_memberships_no_overlap_same_team/);

      await inTenant((client) =>
        client.query(
          `update team_memberships set voided_at = now(), voided_by = $3
            where team_id = $1 and athlete_id = $2`,
          [academy.teamB, academy.athleteOnB, academy.adminUserId],
        ),
      );
      await expect(overlapping()).resolves.toEqual(expect.any(String));
    });

    it('a voided membership grants no access', async () => {
      const database = new DatabaseService(db.url, 2);
      const scopes = new PrincipalScopeRepository();
      const coach = {
        userId: academy.coachUserId,
        academyId: academy.academyId,
        roles: ['coach' as const],
      };
      const visible = () =>
        database.runInTenantTransaction(academy.academyId, async (tx, startedAt) => {
          const scope = await scopes.resolve(tx, coach, startedAt);
          return scope.visibleAthleteIds;
        });

      try {
        expect(await visible()).toEqual([academy.athleteOnA]);

        await inTenant((client) =>
          client.query(
            `update team_memberships set voided_at = now(), voided_by = $3
              where team_id = $1 and athlete_id = $2`,
            [academy.teamA, academy.athleteOnA, academy.adminUserId],
          ),
        );

        // Same coach, same open assignment, same membership row still in the table.
        expect(await visible()).toEqual([]);
      } finally {
        await database.onModuleDestroy();
      }
    });
  });

  describe('final once set', () => {
    // Runs after the correction tests above: the first register entry and team B's
    // membership are voided by now, and the fixture closed team B's coach assignments.
    const refused = (statement: string, params: unknown[]) =>
      expect(inTenant((client) => client.query(statement, params))).rejects;

    it('a closed coach assignment cannot be reopened or extended', async () => {
      // Reopening it is the dangerous one: it would hand a former coach the team back.
      await refused(`update team_coach_assignments set valid_to = null where team_id = $1`, [
        academy.teamB,
      ]).toThrow(/team_coach_assignments\.valid_to is final once set/);
      await refused(
        `update team_coach_assignments set valid_to = now() + interval '1 year' where team_id = $1`,
        [academy.teamB],
      ).toThrow(/team_coach_assignments\.valid_to is final once set/);
    });

    it('a void cannot be undone or re-attributed', async () => {
      await refused(
        `update team_memberships set voided_at = null, voided_by = null where team_id = $1`,
        [academy.teamB],
      ).toThrow(/team_memberships\.voided_at is final once set/);
      await refused(`update session_participants set voided_by = $2 where id = $1`, [
        participantId,
        academy.coachUserId,
      ]).toThrow(/session_participants\.voided_by is final once set/);
    });

    it('an open membership can be closed once, and then not reopened', async () => {
      const membershipId = await inTenant(async (client) => {
        const athlete = await client.query(
          `insert into athletes (academy_id, first_name, last_name, date_of_birth)
           values ($1, 'Final', 'Once', '2008-01-01') returning id`,
          [academy.academyId],
        );
        const membership = await client.query(
          `insert into team_memberships (academy_id, team_id, athlete_id, valid_from)
           values ($1, $2, $3, $4) returning id`,
          [academy.academyId, academy.teamA, athlete.rows[0].id, daysAgo(60)],
        );
        return membership.rows[0].id as string;
      });
      const setValidTo = (value: string | null) =>
        inTenant((client) =>
          client.query(`update team_memberships set valid_to = $2 where id = $1`, [
            membershipId,
            value,
          ]),
        );

      // The transfer path: NULL -> a value is exactly what closing a period is.
      await expect(setValidTo(daysAgo(1))).resolves.toMatchObject({ rowCount: 1 });
      await expect(setValidTo(null)).rejects.toThrow(
        /team_memberships\.valid_to is final once set/,
      );
    });

    it('the owner can still repair a row: the restriction binds the application role', async () => {
      const reopened = await db.adminPool.query(
        `update team_coach_assignments set valid_to = null
          where team_id = $1 and coach_user_id = $2 returning id`,
        [academy.teamB, academy.lapsedCoachUserId],
      );
      expect(reopened.rowCount).toBe(1);
    });
  });

  describe('identity and authority', () => {
    it('cannot read users at all: the table holds credentials and has no tenant policy', async () => {
      await expect(db.pool.query('select id from users')).rejects.toThrow(
        /permission denied for table users/i,
      );
    });

    it('cannot mint a role grant, even inside its own academy', async () => {
      await expect(
        inTenant((client) =>
          client.query(
            `insert into user_academy_roles (academy_id, user_id, role)
             values ($1, $2, 'academy_admin')`,
            [academy.academyId, academy.coachUserId],
          ),
        ),
      ).rejects.toThrow(/permission denied for table user_academy_roles/i);
    });

    it('cannot create a user or an academy', async () => {
      await expect(
        db.pool.query(
          `insert into users (email, password_hash, full_name) values ('x@example.test', 'x', 'X')`,
        ),
      ).rejects.toThrow(/permission denied for table users/i);

      const id = randomUUID();
      await expect(
        asAcademy(db.pool, id, (client) =>
          client.query(`insert into academies (id, name) values ($1, 'Self-made')`, [id]),
        ),
      ).rejects.toThrow(/permission denied for table academies/i);
    });
  });

  describe('future tables', () => {
    it('are unreachable until a migration grants on them explicitly', async () => {
      // 0001 made full DML the DEFAULT for every table created afterwards. Created by
      // the same role that runs the migrations, this one gets nothing.
      await db.adminPool.query('create table future_probe (id integer primary key)');
      try {
        await expect(db.pool.query('select * from future_probe')).rejects.toThrow(
          /permission denied for table future_probe/i,
        );
      } finally {
        await db.adminPool.query('drop table future_probe');
      }
    });
  });

  describe('boot-time assertion', () => {
    it('accepts the application role', async () => {
      const database = new DatabaseService(db.url, 1);
      try {
        await expect(assertDatabasePrivileges(database)).resolves.toBeUndefined();
      } finally {
        await database.onModuleDestroy();
      }
    });

    it('refuses the owner/superuser connection, naming why', async () => {
      const database = new DatabaseService(db.adminUrl, 1);
      try {
        await expect(assertDatabasePrivileges(database)).rejects.toThrow(
          /Refusing to start.*SUPERUSER.*owns/s,
        );
      } finally {
        await database.onModuleDestroy();
      }
    });

    it.each([
      ['grant delete on assessments to athlete_app', /DELETE on assessments/],
      ['grant update (status) on session_participants to athlete_app', /UPDATE \(status\) on session_participants/],
      ['grant select (password_hash) on users to athlete_app', /SELECT \(password_hash\) on users/],
      // has_table_privilege is false for a column-only grant, yet this one mints authority.
      [
        'grant insert (academy_id, user_id, role) on user_academy_roles to athlete_app',
        /INSERT \(academy_id\) on user_academy_roles, INSERT \(user_id\) on user_academy_roles, INSERT \(role\) on user_academy_roles/,
      ],
      ['grant references (id) on athletes to athlete_app', /REFERENCES \(id\) on athletes/],
      ['grant trigger on assessments to athlete_app', /TRIGGER on assessments/],
      ['grant maintain on team_memberships to athlete_app', /MAINTAIN on team_memberships/],
    ])('refuses a non-owner role holding more than the matrix: %s', async (grant, reason) => {
      // Still not a superuser, not an owner, no BYPASSRLS: only the whole matrix catches it.
      const database = new DatabaseService(db.url, 1);
      await db.adminPool.query(grant);
      try {
        await expect(assertDatabasePrivileges(database)).rejects.toThrow(reason);
      } finally {
        await db.adminPool.query(grant.replace('grant', 'revoke').replace(' to ', ' from '));
        await database.onModuleDestroy();
      }
    });

    it('refuses a role that could SET ROLE to one it does not inherit', async () => {
      // Holds nothing extra as connected, so the matrix comparison alone passes it.
      const database = new DatabaseService(db.url, 1);
      await db.adminPool.query('create role probe_platform');
      await db.adminPool.query('grant delete on assessments to probe_platform');
      await db.adminPool.query('grant probe_platform to athlete_app with inherit false');
      try {
        await expect(assertDatabasePrivileges(database)).rejects.toThrow(
          /SET ROLE to probe_platform/,
        );
      } finally {
        await db.adminPool.query('revoke probe_platform from athlete_app');
        await db.adminPool.query('revoke delete on assessments from probe_platform');
        await db.adminPool.query('drop role probe_platform');
        await database.onModuleDestroy();
      }
    });
  });
});
