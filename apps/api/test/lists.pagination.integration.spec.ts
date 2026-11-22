import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  AthleteListQuery,
  AthletePage,
  SessionListQuery,
  SessionPage,
  TeamListQuery,
  TeamPage,
  type Role,
} from '@athlete/contracts';
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
  addMembership,
  createAthlete,
  daysAgo,
  seedAcademy,
  seedTwoTeamAcademy,
  startTestDatabase,
  type SeededAcademy,
  type TestDatabase,
  type TwoTeamAcademy,
} from './support/harness';

/**
 * PROVES: a list is one page of exactly the rows the caller may see, and `total` counts
 * those rows and no others.
 *
 * The count is the new way to leak. A page filtered to a coach's athletes beside a
 * `total` counted over the whole table tells the coach how many athletes the academy
 * has -- a number about rows they cannot read. So every assertion here that a coach
 * sees fewer rows than the administrator is paired with one on `total`.
 *
 * Real services and repositories, run as the interceptor runs them (tenant
 * transaction, scope resolved from the database, scoped ability on the context), with
 * queries parsed by the contract schemas exactly as the validation interceptor does.
 *
 * Fixture, in one academy:
 *
 *   Team A (the coach coaches it now)   Aisha OnA, Zaid Abbas, Omar Khalil, Layla 100%_Real
 *   Team B (the coach left a week ago)  Bilal OnB, Yara Abbasi
 *   sessions on A: 10, 5 and 2 days ago;  on B: 4 and 1 days ago
 */
describe('paginated lists', () => {
  let db: TestDatabase;
  let database: DatabaseService;
  let academy: TwoTeamAcademy;
  let other: SeededAcademy;
  /** Session ids by `<team><days ago>`: A10, A5, A2, B4, B1. */
  const session: Record<string, string> = {};

  const scopes = new PrincipalScopeRepository();
  const teamsRepo = new TeamsRepository();
  const athletes = new AthletesService(new AthletesRepository());
  const teams = new TeamsService(teamsRepo);
  const sessions = new SessionsService(new SessionsRepository(), teamsRepo);

  const principal = (userId: string, role: Role, academyId = academy.academyId): Principal => ({
    userId,
    academyId,
    roles: [role],
  });
  const coach = () => principal(academy.coachUserId, 'coach');
  const lapsedCoach = () => principal(academy.lapsedCoachUserId, 'coach');
  const admin = () => principal(academy.adminUserId, 'academy_admin');
  const otherAdmin = () => principal(other.adminUserId, 'academy_admin', other.academyId);

  /** What `TenantTransactionInterceptor` does for a request. */
  const as = <T>(who: Principal, fn: () => Promise<T>): Promise<T> =>
    database.runInTenantTransaction(who.academyId, async (tx, startedAt) => {
      const scope = await scopes.resolve(tx, who, startedAt);
      const ability = defineAbility(who, { scoped: true, scope });
      return requestContext.run({ ...who, ...scope, ability, tx, requestId: randomUUID() }, fn);
    });

  // A query string as the route receives it: text in, the contract's parsed output out.
  const listAthletes = (who: Principal, query: Record<string, string> = {}) =>
    as(who, () => athletes.list(AthleteListQuery.parse(query)));
  const listTeams = (who: Principal, query: Record<string, string> = {}) =>
    as(who, () => teams.listTeams(TeamListQuery.parse(query)));
  const listSessions = (who: Principal, query: Record<string, string> = {}) =>
    as(who, () => sessions.listSessions(SessionListQuery.parse(query)));

  const names = (page: AthletePage) => page.items.map((a) => `${a.firstName} ${a.lastName}`);
  const noGrant = { type: 'FORBIDDEN', code: 'AUTHZ_NO_GRANT' };

  beforeAll(async () => {
    db = await startTestDatabase();
    database = new DatabaseService(db.url, 2);
    academy = await seedTwoTeamAcademy(db, 'Listing Academy');
    other = await seedAcademy(db, 'Neighbour Academy');

    const { academyId, teamA, teamB } = academy;
    for (const [team, first, last] of [
      [teamA, 'Zaid', 'Abbas'],
      [teamA, 'Omar', 'Khalil'],
      [teamA, 'Layla', '100%_Real'],
      [teamB, 'Yara', 'Abbasi'],
    ] as const) {
      const id = await createAthlete(db.pool, academyId, first, last);
      await addMembership(db.pool, academyId, team, id, daysAgo(60));
    }

    await as(admin(), async () => {
      for (const [key, teamId, days] of [
        ['A10', teamA, 10],
        ['A5', teamA, 5],
        ['A2', teamA, 2],
        ['B4', teamB, 4],
        ['B1', teamB, 1],
      ] as const) {
        const startsAt = daysAgo(days);
        const created = await sessions.createSession({
          teamId,
          startsAt,
          endsAt: new Date(Date.parse(startsAt) + 90 * 60 * 1000).toISOString(),
          location: null,
        });
        session[key] = created.id;
      }
    });
  }, 180_000);

  afterAll(async () => {
    await database?.onModuleDestroy();
    await db?.stop();
  });

  describe('GET /athletes', () => {
    it('an administrator pages through every athlete in the academy', async () => {
      const page = await listAthletes(admin());

      expect(page).toMatchObject({ total: 6, page: 1, pageSize: 25 });
      expect(page.items).toHaveLength(6);
    });

    it('a coach gets only the athletes on the team they coach now, and a total of exactly those', async () => {
      const page = await listAthletes(coach());

      expect(names(page).sort()).toEqual(
        ['Aisha OnA', 'Layla 100%_Real', 'Omar Khalil', 'Zaid Abbas'].sort(),
      );
      // Six athletes exist. Four is the number this coach may see, so four is the total.
      expect(page.total).toBe(4);
    });

    it('the total stays scoped when the page is smaller than the result', async () => {
      const page = await listAthletes(coach(), { pageSize: '1' });

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(4);
    });

    it('sorts by last name by default, and by any listed key in either direction', async () => {
      expect(names(await listAthletes(admin()))).toEqual([
        'Layla 100%_Real',
        'Zaid Abbas',
        'Yara Abbasi',
        'Omar Khalil',
        'Aisha OnA',
        'Bilal OnB',
      ]);
      expect(names(await listAthletes(admin(), { sort: '-lastName' }))).toEqual([
        'Bilal OnB',
        'Aisha OnA',
        'Omar Khalil',
        'Yara Abbasi',
        'Zaid Abbas',
        'Layla 100%_Real',
      ]);
      expect(names(await listAthletes(admin(), { sort: 'firstName' }))[0]).toBe('Aisha OnA');
      expect(names(await listAthletes(admin(), { sort: '-firstName' }))[0]).toBe('Zaid Abbas');
    });

    it('pages without repeating or dropping a row, even where the sort key ties', async () => {
      // Every fixture athlete has the same date of birth, so only the tiebreak orders them.
      const seen: string[] = [];
      for (const page of ['1', '2', '3']) {
        const result = await listAthletes(admin(), { sort: 'dateOfBirth', pageSize: '2', page });
        expect(result).toMatchObject({ total: 6, page: Number(page), pageSize: 2 });
        expect(result.items).toHaveLength(2);
        seen.push(...result.items.map((a) => a.id));
      }
      expect(new Set(seen).size).toBe(6);
    });

    it('a page past the end is empty and still reports the total', async () => {
      const page = await listAthletes(admin(), { page: '9', pageSize: '5' });
      expect(page).toEqual({ items: [], total: 6, page: 9, pageSize: 5 });
    });

    it('q matches the first or the last name, case-insensitively, and total counts the matches', async () => {
      const byLast = await listAthletes(admin(), { q: 'ABBAS' });
      expect(names(byLast)).toEqual(['Zaid Abbas', 'Yara Abbasi']);
      expect(byLast.total).toBe(2);

      const byFirst = await listAthletes(admin(), { q: 'omar' });
      expect(names(byFirst)).toEqual(['Omar Khalil']);

      expect(await listAthletes(admin(), { q: 'nobody' })).toMatchObject({ items: [], total: 0 });
    });

    it('q is searched inside the caller\'s scope: a coach cannot find another team\'s athlete by name', async () => {
      const page = await listAthletes(coach(), { q: 'abbas' });

      // "Yara Abbasi" matches and is on team B. Neither the row nor the count shows her.
      expect(names(page)).toEqual(['Zaid Abbas']);
      expect(page.total).toBe(1);
    });

    it('q takes % and _ literally instead of matching everything', async () => {
      expect((await listAthletes(admin(), { q: '%' })).total).toBe(1);
      expect((await listAthletes(admin(), { q: '_' })).total).toBe(1);
      expect(names(await listAthletes(admin(), { q: '100%_real' }))).toEqual(['Layla 100%_Real']);
    });

    it('answers in the shape the route declares', async () => {
      const page = await listAthletes(coach());
      // Encoding strips what the schema does not name; equality means nothing was stripped.
      expect(AthletePage.parse(page)).toEqual(page);
    });
  });

  describe('GET /teams', () => {
    it('an administrator sees both teams', async () => {
      const page = await listTeams(admin());
      expect(page.items.map((t) => t.name)).toEqual(['Team A', 'Team B']);
      expect(page.total).toBe(2);
      expect(TeamPage.parse(page)).toEqual(page);
    });

    it('a coach sees the team they coach now, not the one they left, and a total of one', async () => {
      const page = await listTeams(coach());
      expect(page.items.map((t) => t.id)).toEqual([academy.teamA]);
      expect(page.total).toBe(1);
    });

    it('sorts by name in either direction and searches the name', async () => {
      expect((await listTeams(admin(), { sort: '-name' })).items.map((t) => t.name)).toEqual([
        'Team B',
        'Team A',
      ]);
      expect((await listTeams(admin(), { q: 'team b' })).items.map((t) => t.name)).toEqual(['Team B']);
      // A coach searching for the team they left finds nothing, and is told there is nothing.
      expect(await listTeams(coach(), { q: 'team b' })).toMatchObject({ items: [], total: 0 });
    });

    it('pages', async () => {
      const second = await listTeams(admin(), { pageSize: '1', page: '2' });
      expect(second.items.map((t) => t.name)).toEqual(['Team B']);
      expect(second).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    });
  });

  describe('GET /teams/:id', () => {
    it('reads a team in scope', async () => {
      expect(await as(coach(), () => teams.getTeam(academy.teamA))).toMatchObject({
        id: academy.teamA,
        name: 'Team A',
      });
      expect((await as(admin(), () => teams.getTeam(academy.teamB))).name).toBe('Team B');
    });

    it('a team outside scope is a 404, the same as one that does not exist', async () => {
      await expect(as(coach(), () => teams.getTeam(academy.teamB))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(as(coach(), () => teams.getTeam(randomUUID()))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(as(otherAdmin(), () => teams.getTeam(academy.teamA))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('GET /sessions', () => {
    const ids = (page: SessionPage) => page.items.map((s) => s.id);

    it('an administrator sees every session, newest first', async () => {
      const page = await listSessions(admin());
      expect(ids(page)).toEqual([session.B1, session.A2, session.B4, session.A5, session.A10]);
      expect(page.total).toBe(5);
      expect(SessionPage.parse(page)).toEqual(page);
    });

    it('a coach sees their team\'s sessions only, and a total of exactly those', async () => {
      const page = await listSessions(coach());
      expect(ids(page)).toEqual([session.A2, session.A5, session.A10]);
      expect(page.total).toBe(3);
    });

    it('sorts oldest first on request', async () => {
      expect(ids(await listSessions(coach(), { sort: 'startsAt' }))).toEqual([
        session.A10,
        session.A5,
        session.A2,
      ]);
    });

    it('filters by team', async () => {
      const page = await listSessions(admin(), { teamId: academy.teamB });
      expect(ids(page)).toEqual([session.B1, session.B4]);
      expect(page.total).toBe(2);
    });

    it('a coach naming a team they do not coach gets nothing, counted as nothing', async () => {
      // The filter narrows the scope; it cannot widen it.
      expect(await listSessions(coach(), { teamId: academy.teamB })).toMatchObject({
        items: [],
        total: 0,
      });
    });

    it('filters by a half-open period over the start time', async () => {
      const page = await listSessions(admin(), { from: daysAgo(6), to: daysAgo(1.5) });
      expect(ids(page)).toEqual([session.A2, session.B4, session.A5]);
      expect(page.total).toBe(3);

      // [from, to): a session starting exactly at `to` is outside, exactly at `from` inside.
      const a5 = (await as(admin(), () => sessions.getSession(session.A5 as string))).startsAt;
      expect(ids(await listSessions(admin(), { from: daysAgo(6), to: a5 }))).not.toContain(session.A5);
      expect(ids(await listSessions(admin(), { from: a5, to: daysAgo(4.5) }))).toEqual([session.A5]);
    });

    it('pages', async () => {
      const second = await listSessions(admin(), { pageSize: '2', page: '2' });
      expect(ids(second)).toEqual([session.B4, session.A5]);
      expect(second).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    });
  });

  describe('GET /sessions/:id', () => {
    it('reads a session in scope', async () => {
      const own = await as(coach(), () => sessions.getSession(session.A2 as string));
      expect(own).toMatchObject({ id: session.A2, teamId: academy.teamA });
    });

    it('a session outside scope is a 404, the same as one that does not exist', async () => {
      await expect(
        as(coach(), () => sessions.getSession(session.B1 as string)),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(as(coach(), () => sessions.getSession(randomUUID()))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        as(otherAdmin(), () => sessions.getSession(session.A2 as string)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('a coach with no current team', () => {
    it('is refused every list rather than shown an empty page', async () => {
      await expect(listAthletes(lapsedCoach())).rejects.toMatchObject(noGrant);
      await expect(listTeams(lapsedCoach())).rejects.toMatchObject(noGrant);
      await expect(listSessions(lapsedCoach())).rejects.toMatchObject(noGrant);
    });

    it('is refused a team and a session by id the same way', async () => {
      await expect(as(lapsedCoach(), () => teams.getTeam(academy.teamB))).rejects.toMatchObject(noGrant);
      await expect(
        as(lapsedCoach(), () => sessions.getSession(session.B1 as string)),
      ).rejects.toMatchObject(noGrant);
    });
  });

  describe('across academies', () => {
    it('every list is empty with a total of zero', async () => {
      for (const list of [listAthletes, listTeams, listSessions]) {
        expect(await list(otherAdmin())).toMatchObject({ items: [], total: 0 });
      }
    });
  });
});
