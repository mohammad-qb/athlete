import { Module } from '@nestjs/common';
import { AthletesController } from './athletes.controller';
import { AthletesRepository } from './athletes.repository';
import { AthletesService } from './athletes.service';
import { PolicyService } from '../../common/authz/policy.service';

@Module({
  controllers: [AthletesController],
  providers: [AthletesService, AthletesRepository, PolicyService],
  exports: [AthletesService],
})
export class AthletesModule {}
