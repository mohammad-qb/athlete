import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateSessionRequest,
  ParticipationResponse,
  RecordAttendanceRequest,
  SessionListQuery,
  SessionPage,
  SessionResponse,
} from '@athlete/contracts';
import { SessionsRepository, type ParticipantRow, type SessionRow } from './sessions.repository';
import { TeamsRepository } from '../teams/teams.repository';
import { assertCan } from '../../common/authz/assert-can';
import { violatedConstraint } from '../../common/db/constraint-violation';
import { ApiError, ApiErrorType } from '../../common/errors/api.error';
import { requestContext } from '../../common/tenancy/request-context';

@Injectable()
export class SessionsService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly teams: TeamsRepository,
  ) {}

  async createSession(input: CreateSessionRequest): Promise<SessionResponse> {
    // A create has no existing row for a filter to exclude, so the row about to be
    // written is checked instead: a coach schedules sessions for their own teams only.
    assertCan('create', 'trainingSessions', { teamId: input.teamId });

    const team = await this.teams.findTeam(
      input.teamId,
      this.teams.accessFilter('read', 'teams'),
    );
    if (!team) throw new NotFoundException(`Team ${input.teamId} not found`);
    const row = await asSessionRefusal(() =>
      this.repository.createSession({
        teamId: input.teamId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        location: input.location,
      }),
    );
    return toSessionResponse(row);
  }

  /**
   * An administrator's list is every session in the academy; a coach's is the sessions
   * of the teams they coach now, with a `total` counted under the same filter.
   */
  async listSessions(query: SessionListQuery): Promise<SessionPage> {
    const { rows, total } = await this.repository.pageOfSessions(
      query,
      this.repository.accessFilter('read', 'trainingSessions'),
    );
    return {
      items: rows.map(toSessionResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getSession(sessionId: string): Promise<SessionResponse> {
    return toSessionResponse(await this.readableSession(sessionId));
  }

  /**
   * Records attendance as participation facts.
   *
   * Membership is verified AS AT THE SESSION START, not as at now. Recording a register
   * for last Tuesday therefore stays correct even if the athlete has since transferred,
   * and an athlete who was not on the team that day cannot be added retroactively.
   */
  async recordAttendance(
    sessionId: string,
    input: RecordAttendanceRequest,
  ): Promise<ParticipationResponse[]> {
    const session = await this.readableSession(sessionId);

    // The register rows about to be written carry the session's team as their
    // `teamIdAtTime`, and that is the field the rule conditions on.
    assertCan('create', 'sessionParticipants', { teamIdAtTime: session.teamId });

    const { userId } = requestContext.require();

    const memberships = this.teams.accessFilter('read', 'teamMemberships');
    for (const entry of input.entries) {
      const wasMember = await this.teams.wasMemberAt(
        session.teamId,
        entry.athleteId,
        session.startsAt,
        memberships,
      );
      if (!wasMember) {
        throw new ApiError("An athlete was not on the session's team when it started", {
          type: ApiErrorType.BAD_REQUEST,
          code: 'athlete_not_on_team',
          meta: { athleteId: entry.athleteId },
          explanation:
            'A register holds the athletes who were on the team at the start of the ' +
            'session. Reload the register to see who that was.',
        });
      }
    }

    const rows = await asSessionRefusal(() =>
      this.repository.recordParticipation(
        input.entries.map((entry) => ({
          sessionId,
          athleteId: entry.athleteId,
          teamIdAtTime: session.teamId,
          status: entry.status,
          note: entry.note,
          clientRecordId: entry.clientRecordId,
          recordedByUserId: userId,
        })),
      ),
    );

    // A replay inserts only the entries that are not stored yet, possibly none. The
    // answer is the stored register whenever anything was replayed, so the client
    // converges on server state rather than guessing which of its entries were new.
    if (rows.length < input.entries.length) {
      return this.storedRegister(sessionId);
    }
    return rows.map(toParticipationResponse);
  }

  async register(sessionId: string): Promise<ParticipationResponse[]> {
    await this.readableSession(sessionId);
    return this.storedRegister(sessionId);
  }

  /** A session outside the principal's scope is indistinguishable from one that is not there. */
  private async readableSession(sessionId: string): Promise<SessionRow> {
    const session = await this.repository.findSession(
      sessionId,
      this.repository.accessFilter('read', 'trainingSessions'),
    );
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    return session;
  }

  private async storedRegister(sessionId: string): Promise<ParticipationResponse[]> {
    const rows = await this.repository.participantsFor(
      sessionId,
      this.repository.accessFilter('read', 'sessionParticipants'),
    );
    return rows.map(toParticipationResponse);
  }
}

/**
 * Rules the DATABASE enforces on these writes (`0000_init.sql`, `0002_grants.sql`).
 * Left alone, a write that breaks one fails in the driver and is answered as a redacted
 * 500, which tells a coach holding a phone nothing. Each is named here with what it
 * means to the caller; anything else is rethrown. (Same shape as the membership
 * refusals in `teams.service.ts`.)
 */
const SESSION_REFUSALS: Record<string, () => ApiError> = {
  training_sessions_time_valid: () =>
    new ApiError('A session must end after it starts', {
      type: ApiErrorType.BAD_REQUEST,
      code: 'session_time_invalid',
    }),
  // The same athlete, recorded for this session under a DIFFERENT clientRecordId: a
  // second device, or a second coach. A replay of the same id never gets here; it is a
  // no-op. Nothing of the request is stored: the statement failed as a whole.
  session_participants_once_per_session: () =>
    new ApiError('Attendance is already recorded for an athlete in this register', {
      type: ApiErrorType.CONFLICT,
      code: 'attendance_already_recorded',
      explanation:
        'Someone else recorded part of this register. Reload it, then submit the ' +
        'athletes who are still unmarked.',
    }),
};

async function asSessionRefusal<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const constraint = violatedConstraint(error);
    const refusal = constraint === undefined ? undefined : SESSION_REFUSALS[constraint];
    if (!refusal) throw error;
    throw refusal();
  }
}

function toSessionResponse(row: SessionRow): SessionResponse {
  return {
    id: row.id,
    academyId: row.academyId,
    teamId: row.teamId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    location: row.location,
  };
}

function toParticipationResponse(row: ParticipantRow): ParticipationResponse {
  return {
    id: row.id,
    academyId: row.academyId,
    sessionId: row.sessionId,
    athleteId: row.athleteId,
    teamIdAtTime: row.teamIdAtTime,
    status: row.status as ParticipationResponse['status'],
    note: row.note,
    recordedAt: row.recordedAt.toISOString(),
  };
}
