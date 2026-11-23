import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateMembershipRequest,
  CreateTeamRequest,
  MembershipResponse,
  RosterResponse,
  TeamListQuery,
  TeamPage,
  TeamResponse,
  TransferAthleteRequest,
  TransferResponse,
} from '@athlete/contracts';
import { TeamsRepository, type MembershipRow, type TeamRow } from './teams.repository';
import { assertCan } from '../../common/authz/assert-can';
import { isInvertedRange, violatedConstraint } from '../../common/db/constraint-violation';
import { ApiError, ApiErrorType } from '../../common/errors/api.error';

@Injectable()
export class TeamsService {
  constructor(private readonly repository: TeamsRepository) {}

  async createTeam(input: CreateTeamRequest): Promise<TeamResponse> {
    return toTeamResponse(await this.repository.createTeam(input));
  }

  /**
   * An administrator's list is every team in the academy; a coach's is the teams they
   * coach now, with a `total` counted under the same filter. A coach with no current
   * team is refused by `accessFilter` rather than shown an empty page.
   */
  async listTeams(query: TeamListQuery): Promise<TeamPage> {
    const { rows, total } = await this.repository.pageOfTeams(
      query,
      this.repository.accessFilter('read', 'teams'),
    );
    return { items: rows.map(toTeamResponse), total, page: query.page, pageSize: query.pageSize };
  }

  /** A team outside the principal's scope is indistinguishable from one that is not there. */
  async getTeam(teamId: string): Promise<TeamResponse> {
    return toTeamResponse(await this.requireTeam(teamId));
  }

  async addMembership(
    teamId: string,
    input: CreateMembershipRequest,
  ): Promise<MembershipResponse> {
    await this.requireTeam(teamId);
    const row = await asMembershipRefusal(() =>
      this.repository.addMembership({
        teamId,
        athleteId: input.athleteId,
        validFrom: new Date(input.validFrom),
        validTo: input.validTo ? new Date(input.validTo) : null,
      }),
    );
    return toMembershipResponse(row);
  }

  /**
   * Transfer = close one period, open another, in one transaction.
   *
   * Nothing is overwritten and no row is deleted, so every session, attendance record
   * and assessment that referenced the old arrangement still resolves correctly. The
   * database's exclusion constraint guarantees the two periods cannot overlap within a
   * team, so this cannot produce a contradictory history even under concurrency --
   * a second concurrent transfer fails rather than interleaving.
   */
  async transfer(input: TransferAthleteRequest): Promise<TransferResponse> {
    if (input.fromTeamId === input.toTeamId) {
      throw new ApiError('Source and destination teams are the same', {
        type: ApiErrorType.BAD_REQUEST,
        code: 'transfer_same_team',
      });
    }
    await this.requireTeam(input.fromTeamId);
    await this.requireTeam(input.toTeamId);

    const effectiveAt = new Date(input.effectiveAt);

    const closed = await asMembershipRefusal(() =>
      this.repository.closeOpenMembership(input.fromTeamId, input.athleteId, effectiveAt),
    );
    if (!closed) {
      throw new ApiError('The athlete has no open membership in the team they are leaving', {
        type: ApiErrorType.BAD_REQUEST,
        code: 'no_open_membership',
        meta: { athleteId: input.athleteId, teamId: input.fromTeamId },
      });
    }

    const opened = await asMembershipRefusal(() =>
      this.repository.addMembership({
        teamId: input.toTeamId,
        athleteId: input.athleteId,
        validFrom: effectiveAt,
        validTo: null,
      }),
    );

    return { closed: toMembershipResponse(closed), opened: toMembershipResponse(opened) };
  }

  /**
   * `at` chooses WHICH period to show and is a query concern. Authorization is the team
   * scope as it stands now: a coach reads any date of a roster they currently answer
   * for, and no date of one they do not -- including a team they coached last month.
   */
  async rosterAt(teamId: string, at: Date): Promise<RosterResponse> {
    // The team id is the scope key, so the refusal is a 403 and needs no read.
    assertCan('read', 'teamMemberships', { teamId });
    await this.requireTeam(teamId);
    return this.repository.rosterAt(
      teamId,
      at,
      this.repository.accessFilter('read', 'teamMemberships'),
    );
  }

  private async requireTeam(teamId: string): Promise<TeamRow> {
    const team = await this.repository.findTeam(
      teamId,
      this.repository.accessFilter('read', 'teams'),
    );
    if (!team) throw new NotFoundException(`Team ${teamId} not found`);
    return team;
  }
}

/**
 * The temporal rules of membership are the DATABASE's (`0000_init.sql`), so a write
 * that breaks one fails inside the driver. Left alone that is a redacted 500, which
 * tells the person adding an athlete nothing. Each constraint a membership write can
 * violate is named here with what it means to the caller; anything else is rethrown.
 *
 * The statement has already failed, so the request's transaction is rolled back: a
 * transfer refused at its second step leaves the first one undone.
 */
const periodInvalid = () =>
  new ApiError('A membership must end after it starts', {
    type: ApiErrorType.BAD_REQUEST,
    code: 'membership_period_invalid',
    explanation:
      'For a transfer, the effective date must be later than the date the athlete joined ' +
      'the team they are leaving.',
  });

const MEMBERSHIP_REFUSALS: Record<string, () => ApiError> = {
  team_memberships_no_overlap_same_team: () =>
    new ApiError('The athlete is already on this team during that period', {
      type: ApiErrorType.CONFLICT,
      code: 'membership_overlap',
      explanation:
        'An athlete cannot hold two memberships of one team whose periods overlap. ' +
        'Choose dates outside the existing membership.',
    }),
  // An end EQUAL to the start reaches this CHECK; an end BEFORE it fails earlier, when
  // the generated `period` range is built, and is recognised by `isInvertedRange`.
  team_memberships_period_valid: periodInvalid,
  team_memberships_athlete_fk: () =>
    new ApiError('Athlete not found', { type: ApiErrorType.NOT_FOUND, code: 'athlete_not_found' }),
};

async function asMembershipRefusal<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isInvertedRange(error)) throw periodInvalid();
    const constraint = violatedConstraint(error);
    const refusal = constraint === undefined ? undefined : MEMBERSHIP_REFUSALS[constraint];
    if (!refusal) throw error;
    throw refusal();
  }
}

function toTeamResponse(row: TeamRow): TeamResponse {
  return {
    id: row.id,
    academyId: row.academyId,
    name: row.name,
    sport: row.sport,
    ageGroup: row.ageGroup,
    version: row.version,
  };
}

function toMembershipResponse(row: MembershipRow): MembershipResponse {
  return {
    id: row.id,
    academyId: row.academyId,
    teamId: row.teamId,
    athleteId: row.athleteId,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : null,
  };
}
