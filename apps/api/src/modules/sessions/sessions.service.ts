import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateSessionRequest,
  ParticipationResponse,
  RecordAttendanceRequest,
  SessionResponse,
} from '@athlete/contracts';
import { SessionsRepository, type ParticipantRow, type SessionRow } from './sessions.repository';
import { TeamsRepository } from '../teams/teams.repository';
import { assertCan } from '../../common/authz/assert-can';
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
    const row = await this.repository.createSession({
      teamId: input.teamId,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      location: input.location,
    });
    return toSessionResponse(row);
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
        throw new BadRequestException(
          `Athlete ${entry.athleteId} was not a member of team ${session.teamId} at ${session.startsAt.toISOString()}`,
        );
      }
    }

    const rows = await this.repository.recordParticipation(
      input.entries.map((entry) => ({
        sessionId,
        athleteId: entry.athleteId,
        teamIdAtTime: session.teamId,
        status: entry.status,
        note: entry.note,
        clientRecordId: entry.clientRecordId,
        recordedByUserId: userId,
      })),
    );

    // Replayed submissions insert nothing; return the stored register either way so the
    // client converges on server state rather than guessing.
    if (rows.length === 0) {
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
