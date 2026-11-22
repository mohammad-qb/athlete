import { Controller, Get, Post } from '@nestjs/common';
import {
  CreateMembershipRequest,
  CreateTeamRequest,
  IdParams,
  RosterQuery,
  TransferAthleteRequest,
  type MembershipResponse,
  type TeamResponse,
} from '@athlete/contracts';
import { TeamsService } from './teams.service';
import { Permission } from '../../common/authz/permission.decorator';
import {
  Validate,
  ValidBody,
  ValidParams,
  ValidQuery,
} from '../../common/validation/validate.decorator';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  @Permission({ action: 'create', subject: 'teams' })
  @Validate({ body: CreateTeamRequest })
  createTeam(@ValidBody() body: CreateTeamRequest): Promise<TeamResponse> {
    return this.teams.createTeam(body);
  }

  @Post(':id/memberships')
  @Permission({ action: 'create', subject: 'teamMemberships' })
  @Validate({ params: IdParams, body: CreateMembershipRequest })
  addMembership(
    @ValidParams('id') teamId: string,
    @ValidBody() body: CreateMembershipRequest,
  ): Promise<MembershipResponse> {
    return this.teams.addMembership(teamId, body);
  }

  /** `at` defaults to now, so the same endpoint answers "who is on this team" and "who was". */
  @Get(':id/roster')
  @Permission({ action: 'read', subject: 'teamMemberships' })
  @Validate({ params: IdParams, query: RosterQuery })
  roster(@ValidParams('id') teamId: string, @ValidQuery() query: RosterQuery) {
    // `at` has parsed as an ISO-8601 instant by the time it gets here, so this Date is
    // never Invalid -- which is what used to reach the driver and come back as a 500.
    return this.teams.rosterAt(teamId, query.at ? new Date(query.at) : new Date());
  }

  @Post('transfers')
  @Permission({ action: 'update', subject: 'teamMemberships' })
  @Validate({ body: TransferAthleteRequest })
  transfer(@ValidBody() body: TransferAthleteRequest) {
    return this.teams.transfer(body);
  }
}
