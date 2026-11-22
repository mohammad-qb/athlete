import { Module } from '@nestjs/common';
import { AthletesController } from './athletes.controller';
import { AthletesRepository } from './athletes.repository';
import { AthletesService } from './athletes.service';

@Module({
  controllers: [AthletesController],
  providers: [AthletesService, AthletesRepository],
  exports: [AthletesService],
})
export class AthletesModule {}
