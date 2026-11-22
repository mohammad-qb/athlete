import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CreateMembershipRequest,
  CreateTeamRequest,
  TransferAthleteRequest,
  type MembershipResponse,
  type TeamResponse,
  Uuid,
} from '@athlete/contracts';
import { TeamsService } from './teams.service';
import { Permission } from '../../common/authz/permission.decorator';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  @Permission({ action: 'create', subject: 'teams' })
  createTeam(
    @Body(new ZodValidationPipe(CreateTeamRequest)) body: CreateTeamRequest,
  ): Promise<TeamResponse> {
    return this.teams.createTeam(body);
  }

  @Post(':id/memberships')
  @Permission({ action: 'create', subject: 'teamMemberships' })
  addMembership(
    @Param('id', new ZodValidationPipe(Uuid)) teamId: string,
    @Body(new ZodValidationPipe(CreateMembershipRequest)) body: CreateMembershipRequest,
  ): Promise<MembershipResponse> {
    return this.teams.addMembership(teamId, body);
  }

  /** `at` defaults to now, so the same endpoint answers "who is on this team" and "who was". */
  @Get(':id/roster')
  @Permission({ action: 'read', subject: 'teamMemberships' })
  roster(@Param('id', new ZodValidationPipe(Uuid)) teamId: string, @Query('at') at?: string) {
    return this.teams.rosterAt(teamId, at ? new Date(at) : new Date());
  }

  @Post('transfers')
  @Permission({ action: 'update', subject: 'teamMemberships' })
  transfer(
    @Body(new ZodValidationPipe(TransferAthleteRequest)) body: TransferAthleteRequest,
  ) {
    return this.teams.transfer(body);
  }
}
