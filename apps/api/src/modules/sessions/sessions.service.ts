import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateSessionRequest,
  ParticipationResponse,
  RecordAttendanceRequest,
  SessionResponse,
} from '@athlete/contracts';
import { SessionsRepository, type ParticipantRow, type SessionRow } from './sessions.repository';
import { TeamsRepository } from '../teams/teams.repository';
import { PolicyService } from '../../common/authz/policy.service';
import { requestContext } from '../../common/tenancy/request-context';

@Injectable()
export class SessionsService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly teams: TeamsRepository,
    private readonly policies: PolicyService,
  ) {}

  async createSession(input: CreateSessionRequest): Promise<SessionResponse> {
    const team = await this.teams.findTeam(input.teamId);
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
    const session = await this.repository.findSession(sessionId);
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

    await this.policies.assertCanRecordAttendanceForTeam(session.teamId);

    const { userId } = requestContext.require();

    for (const entry of input.entries) {
      const wasMember = await this.teams.wasMemberAt(
        session.teamId,
        entry.athleteId,
        session.startsAt,
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
      return (await this.repository.participantsFor(sessionId)).map(toParticipationResponse);
    }
    return rows.map(toParticipationResponse);
  }

  async register(sessionId: string): Promise<ParticipationResponse[]> {
    const session = await this.repository.findSession(sessionId);
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    const rows = await this.repository.participantsFor(sessionId);
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
