import { Controller, Get, Post } from '@nestjs/common';
import {
  CreateMembershipRequest,
  CreateTeamRequest,
  IdParams,
  MembershipResponse,
  RosterQuery,
  RosterResponse,
  TeamListQuery,
  TeamPage,
  TeamResponse,
  TransferAthleteRequest,
  TransferResponse,
} from '@athlete/contracts';
import { TeamsService } from './teams.service';
import { Permission } from '../../common/authz/permission.decorator';
import { Responds } from '../../common/validation/responds.decorator';
import {
  Validate,
  ValidBody,
  ValidParams,
  ValidQuery,
} from '../../common/validation/validate.decorator';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @Permission({ action: 'read', subject: 'teams' })
  @Validate({ query: TeamListQuery })
  @Responds(TeamPage)
  list(@ValidQuery() query: TeamListQuery): Promise<TeamPage> {
    return this.teams.listTeams(query);
  }

  @Post()
  @Permission({ action: 'create', subject: 'teams' })
  @Validate({ body: CreateTeamRequest })
  @Responds(TeamResponse)
  create(@ValidBody() body: CreateTeamRequest): Promise<TeamResponse> {
    return this.teams.createTeam(body);
  }

  /** So a roster page can be opened by its URL: the team's own name and sport. */
  @Get(':id')
  @Permission({ action: 'read', subject: 'teams' })
  @Validate({ params: IdParams })
  @Responds(TeamResponse)
  getById(@ValidParams('id') id: string): Promise<TeamResponse> {
    return this.teams.getTeam(id);
  }

  @Post(':id/memberships')
  @Permission({ action: 'create', subject: 'teamMemberships' })
  @Validate({ params: IdParams, body: CreateMembershipRequest })
  @Responds(MembershipResponse)
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
  @Responds(RosterResponse)
  roster(
    @ValidParams('id') teamId: string,
    @ValidQuery() query: RosterQuery,
  ): Promise<RosterResponse> {
    // `at` has parsed as an ISO-8601 instant by the time it gets here, so this Date is
    // never Invalid -- which is what used to reach the driver and come back as a 500.
    return this.teams.rosterAt(teamId, query.at ? new Date(query.at) : new Date());
  }

  @Post('transfers')
  @Permission({ action: 'update', subject: 'teamMemberships' })
  @Validate({ body: TransferAthleteRequest })
  @Responds(TransferResponse)
  transfer(@ValidBody() body: TransferAthleteRequest): Promise<TransferResponse> {
    return this.teams.transfer(body);
  }
}
