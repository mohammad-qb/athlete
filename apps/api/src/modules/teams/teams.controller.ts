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
import { Authorize } from '../../common/authz/authorize.decorator';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  @Authorize({ roles: ['academy_admin'] })
  createTeam(
    @Body(new ZodValidationPipe(CreateTeamRequest)) body: CreateTeamRequest,
  ): Promise<TeamResponse> {
    return this.teams.createTeam(body);
  }

  @Post(':id/memberships')
  @Authorize({ roles: ['academy_admin'] })
  addMembership(
    @Param('id', new ZodValidationPipe(Uuid)) teamId: string,
    @Body(new ZodValidationPipe(CreateMembershipRequest)) body: CreateMembershipRequest,
  ): Promise<MembershipResponse> {
    return this.teams.addMembership(teamId, body);
  }

  /** `at` defaults to now, so the same endpoint answers "who is on this team" and "who was". */
  @Get(':id/roster')
  @Authorize({ roles: ['academy_admin', 'coach'] })
  roster(@Param('id', new ZodValidationPipe(Uuid)) teamId: string, @Query('at') at?: string) {
    return this.teams.rosterAt(teamId, at ? new Date(at) : new Date());
  }

  @Post('transfers')
  @Authorize({ roles: ['academy_admin'] })
  transfer(
    @Body(new ZodValidationPipe(TransferAthleteRequest)) body: TransferAthleteRequest,
  ) {
    return this.teams.transfer(body);
  }
}
