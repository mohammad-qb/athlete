import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { Role } from '@athlete/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineAbility } from '../src/common/authz/ability';
import type { Principal } from '../src/common/authz/principal';
import { PrincipalScopeRepository } from '../src/common/authz/principal-scope.repository';
import { DatabaseService } from '../src/common/tenancy/database.service';
import { requestContext } from '../src/common/tenancy/request-context';
import { AthletesRepository } from '../src/modules/athletes/athletes.repository';
import { AthletesService } from '../src/modules/athletes/athletes.service';
import { SessionsRepository } from '../src/modules/sessions/sessions.repository';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { TeamsRepository } from '../src/modules/teams/teams.repository';
import { TeamsService } from '../src/modules/teams/teams.service';
import {
  daysAgo,
  seedAcademy,
  seedTwoTeamAcademy,
  startTestDatabase,
  type SeededAcademy,
  type TestDatabase,
  type TwoTeamAcademy,
} from './support/harness';

/**
 * PROVES: inside one academy, a principal reaches only the rows they answer for.
 *
 * RLS draws the line BETWEEN academies; this is the line within one. Before these
 * filters existed, any coach could list every athlete and read every team's roster at
 * any date -- including a coach whose assignment had closed, the exact case the design
 * exists for. Each block here fails if its endpoint stops consulting the scoped
 * ability, and the last block fails if a repository stops applying the predicate it is
 * handed.
 *
 * The services and repositories are the real ones, run the way the interceptor runs
 * them: inside a tenant transaction, scope resolved from the database, scoped ability on
 * the request context.
 */
describe('resource scoping within an academy', () => {
  let db: TestDatabase;
  let database: DatabaseService;
  let academy: TwoTeamAcademy;
  let other: SeededAcademy;
  let sessionOnA: string;
  let sessionOnB: string;

  const scopes = new PrincipalScopeRepository();
  const athletesRepo = new AthletesRepository();
  const teamsRepo = new TeamsRepository();
  const sessionsRepo = new SessionsRepository();
  const athletes = new AthletesService(athletesRepo);
  const teams = new TeamsService(teamsRepo);
  const sessions = new SessionsService(sessionsRepo, teamsRepo);

  const principal = (userId: string, role: Role, academyId = academy.academyId): Principal => ({
    userId,
    academyId,
    roles: [role],
  });
  const coach = () => principal(academy.coachUserId, 'coach');
  const lapsedCoach = () => principal(academy.lapsedCoachUserId, 'coach');
  const admin = () => principal(academy.adminUserId, 'academy_admin');
  const otherAdmin = () => principal(other.adminUserId, 'academy_admin', other.academyId);

  /**
   * What `TenantTransactionInterceptor` does for a request. `asOf` defaults to the
   * database clock, as it does there; a test may supply an earlier instant to ask what
   * the same principal could reach then.
   */
  const as = <T>(who: Principal, fn: () => Promise<T>, asOf?: string): Promise<T> =>
    database.runInTenantTransaction(who.academyId, async (tx, startedAt) => {
      const scope = await scopes.resolve(tx, who, asOf ? new Date(asOf) : startedAt);
      const ability = defineAbility(who, { scoped: true, scope });
      return requestContext.run({ ...who, ...scope, ability, tx, requestId: randomUUID() }, fn);
    });

  const outOfScope = { type: 'FORBIDDEN', code: 'AUTHZ_OUT_OF_SCOPE' };
  const noGrant = { type: 'FORBIDDEN', code: 'AUTHZ_NO_GRANT' };

  const sessionInput = (teamId: string) => ({
    teamId,
    startsAt: daysAgo(2),
    endsAt: new Date(Date.parse(daysAgo(2)) + 90 * 60 * 1000).toISOString(),
    location: null,
  });

  beforeAll(async () => {
    db = await startTestDatabase();
    database = new DatabaseService(db.url, 2);
    academy = await seedTwoTeamAcademy(db, 'Scoping Academy');
    other = await seedAcademy(db, 'Neighbour Academy');

    // One session per team with a register, recorded by the administrator.
    [sessionOnA, sessionOnB] = await as(admin(), async () => {
      const ids: string[] = [];
      for (const [teamId, athleteId] of [
        [academy.teamA, academy.athleteOnA],
        [academy.teamB, academy.athleteOnB],
      ] as const) {
        const session = await sessions.createSession(sessionInput(teamId));
        await sessions.recordAttendance(session.id, {
          entries: [{ athleteId, status: 'present', note: null, clientRecordId: randomUUID() }],
        });
        ids.push(session.id);
      }
      return ids as [string, string];
    });
  }, 180_000);

  afterAll(async () => {
    await database?.onModuleDestroy();
    await db?.stop();
  });

  describe('a coach', () => {
    it('lists only the athletes on the team they coach now', async () => {
      const listed = await as(coach(), () => athletes.list());
      expect(listed.map((a) => a.id)).toEqual([academy.athleteOnA]);
    });

    it('reads their own athlete and is refused another team\'s', async () => {
      const own = await as(coach(), () => athletes.getById(academy.athleteOnA));
      expect(own.id).toBe(academy.athleteOnA);

      await expect(as(coach(), () => athletes.getById(academy.athleteOnB))).rejects.toMatchObject(
        outOfScope,
      );
    });

    it('cannot edit another team\'s athlete, and the row is left alone', async () => {
      await expect(
        as(coach(), () => athletes.update(academy.athleteOnB, 0, { lastName: 'Edited' })),
      ).rejects.toMatchObject(outOfScope);

      const after = await as(admin(), () => athletes.getById(academy.athleteOnB));
      expect(after).toMatchObject({ lastName: 'OnB', version: 0 });
    });

    it('reads the roster of their team and is refused an unassigned team\'s', async () => {
      const roster = await as(coach(), () => teams.rosterAt(academy.teamA, new Date()));
      expect(roster.map((r) => r.athleteId)).toEqual([academy.athleteOnA]);

      await expect(
        as(coach(), () => teams.rosterAt(academy.teamB, new Date())),
      ).rejects.toMatchObject(outOfScope);
    });

    it('is refused a past date of a roster they do not hold: `at` picks the period, not the permission', async () => {
      await expect(
        as(coach(), () => teams.rosterAt(academy.teamB, new Date(daysAgo(30)))),
      ).rejects.toMatchObject(outOfScope);
    });

    it('schedules a session for their own team only', async () => {
      const created = await as(coach(), () => sessions.createSession(sessionInput(academy.teamA)));
      expect(created.teamId).toBe(academy.teamA);

      await expect(
        as(coach(), () => sessions.createSession(sessionInput(academy.teamB))),
      ).rejects.toMatchObject(outOfScope);
    });

    it('reads their own team\'s register; another team\'s session does not exist for them', async () => {
      const register = await as(coach(), () => sessions.register(sessionOnA));
      expect(register.map((p) => p.athleteId)).toEqual([academy.athleteOnA]);

      await expect(as(coach(), () => sessions.register(sessionOnB))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        as(coach(), () =>
          sessions.recordAttendance(sessionOnB, {
            entries: [
              {
                athleteId: academy.athleteOnB,
                status: 'absent',
                note: null,
                clientRecordId: randomUUID(),
              },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('a coach whose assignment has closed', () => {
    it('could read the roster last month and is refused it today', async () => {
      // Same coach, same team, same data. Only the instant differs: the assignment to
      // team B ran from 90 days ago to 7 days ago.
      const lastMonth = await as(
        coach(),
        () => teams.rosterAt(academy.teamB, new Date(daysAgo(30))),
        daysAgo(30),
      );
      expect(lastMonth.map((r) => r.athleteId)).toEqual([academy.athleteOnB]);

      await expect(
        as(coach(), () => teams.rosterAt(academy.teamB, new Date(daysAgo(30)))),
      ).rejects.toMatchObject(outOfScope);
    });

    it('with no current team at all is told so, not shown an empty list', async () => {
      await expect(as(lapsedCoach(), () => athletes.list())).rejects.toMatchObject(noGrant);
      await expect(
        as(lapsedCoach(), () => teams.rosterAt(academy.teamB, new Date())),
      ).rejects.toMatchObject({ type: 'FORBIDDEN' });
      await expect(
        as(lapsedCoach(), () => athletes.getById(academy.athleteOnB)),
      ).rejects.toMatchObject({ type: 'FORBIDDEN' });
    });
  });

  describe('an academy administrator', () => {
    it('sees every athlete, roster and register in the academy', async () => {
      const listed = await as(admin(), () => athletes.list());
      expect(listed.map((a) => a.id).sort()).toEqual(
        [academy.athleteOnA, academy.athleteOnB].sort(),
      );

      const rosterB = await as(admin(), () => teams.rosterAt(academy.teamB, new Date()));
      expect(rosterB.map((r) => r.athleteId)).toEqual([academy.athleteOnB]);

      const registerB = await as(admin(), () => sessions.register(sessionOnB));
      expect(registerB).toHaveLength(1);
    });
  });

  describe('across academies', () => {
    it('nothing is reachable, even for an administrator of the other academy', async () => {
      expect(await as(otherAdmin(), () => athletes.list())).toEqual([]);

      const attempts: (() => Promise<unknown>)[] = [
        () => athletes.getById(academy.athleteOnA),
        () => teams.rosterAt(academy.teamA, new Date()),
        () => sessions.register(sessionOnA),
        () => sessions.createSession(sessionInput(academy.teamA)),
      ];
      for (const attempt of attempts) {
        await expect(as(otherAdmin(), attempt)).rejects.toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe('repositories apply the access predicate they are given', () => {
    // The services above also instance-check, so on their own they would not notice a
    // repository that accepted the predicate and ignored it. These call the
    // repositories directly with the coach's filter and a row outside it.
    it('athletes', async () => {
      await as(coach(), async () => {
        const read = athletesRepo.accessFilter('read');
        expect(await athletesRepo.findById(academy.athleteOnB, read)).toBeUndefined();
        expect((await athletesRepo.list(read)).map((a) => a.id)).toEqual([academy.athleteOnA]);
        expect(
          await athletesRepo.updateIfVersionMatches(
            academy.athleteOnB,
            0,
            { lastName: 'Edited' },
            athletesRepo.accessFilter('update'),
          ),
        ).toBeUndefined();
      });
    });

    it('teams and memberships', async () => {
      await as(coach(), async () => {
        const memberships = teamsRepo.accessFilter('read', 'teamMemberships');
        expect(
          await teamsRepo.findTeam(academy.teamB, teamsRepo.accessFilter('read', 'teams')),
        ).toBeUndefined();
        expect(await teamsRepo.rosterAt(academy.teamB, new Date(), memberships)).toEqual([]);
        expect(
          await teamsRepo.wasMemberAt(academy.teamB, academy.athleteOnB, new Date(), memberships),
        ).toBe(false);
      });
    });

    it('sessions and registers', async () => {
      await as(coach(), async () => {
        expect(
          await sessionsRepo.findSession(
            sessionOnB,
            sessionsRepo.accessFilter('read', 'trainingSessions'),
          ),
        ).toBeUndefined();
        expect(
          await sessionsRepo.participantsFor(
            sessionOnB,
            sessionsRepo.accessFilter('read', 'sessionParticipants'),
          ),
        ).toEqual([]);
      });
    });
  });
});
