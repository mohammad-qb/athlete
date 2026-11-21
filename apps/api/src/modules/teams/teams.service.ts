import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateMembershipRequest,
  CreateTeamRequest,
  MembershipResponse,
  TeamResponse,
  TransferAthleteRequest,
} from '@athlete/contracts';
import { TeamsRepository, type MembershipRow, type TeamRow } from './teams.repository';

@Injectable()
export class TeamsService {
  constructor(private readonly repository: TeamsRepository) {}

  async createTeam(input: CreateTeamRequest): Promise<TeamResponse> {
    return toTeamResponse(await this.repository.createTeam(input));
  }

  async addMembership(
    teamId: string,
    input: CreateMembershipRequest,
  ): Promise<MembershipResponse> {
    await this.requireTeam(teamId);
    const row = await this.repository.addMembership({
      teamId,
      athleteId: input.athleteId,
      validFrom: new Date(input.validFrom),
      validTo: input.validTo ? new Date(input.validTo) : null,
    });
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
  async transfer(input: TransferAthleteRequest): Promise<{
    closed: MembershipResponse | null;
    opened: MembershipResponse;
  }> {
    if (input.fromTeamId === input.toTeamId) {
      throw new BadRequestException('Source and destination teams are the same');
    }
    await this.requireTeam(input.fromTeamId);
    await this.requireTeam(input.toTeamId);

    const effectiveAt = new Date(input.effectiveAt);

    const closed = await this.repository.closeOpenMembership(
      input.fromTeamId,
      input.athleteId,
      effectiveAt,
    );
    if (!closed) {
      throw new BadRequestException(
        `Athlete ${input.athleteId} has no open membership in team ${input.fromTeamId}`,
      );
    }

    const opened = await this.repository.addMembership({
      teamId: input.toTeamId,
      athleteId: input.athleteId,
      validFrom: effectiveAt,
      validTo: null,
    });

    return { closed: toMembershipResponse(closed), opened: toMembershipResponse(opened) };
  }

  async rosterAt(teamId: string, at: Date) {
    await this.requireTeam(teamId);
    return this.repository.rosterAt(teamId, at);
  }

  private async requireTeam(teamId: string): Promise<TeamRow> {
    const team = await this.repository.findTeam(teamId);
    if (!team) throw new NotFoundException(`Team ${teamId} not found`);
    return team;
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
