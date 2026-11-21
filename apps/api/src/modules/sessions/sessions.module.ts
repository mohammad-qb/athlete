import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { TeamsModule } from '../teams/teams.module';
import { PolicyService } from '../../common/authz/policy.service';

@Module({
  imports: [TeamsModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsRepository, PolicyService],
})
export class SessionsModule {}
