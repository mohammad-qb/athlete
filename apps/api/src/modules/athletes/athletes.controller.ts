import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateAthleteRequest,
  UpdateAthleteRequest,
  type AthleteResponse,
  Uuid,
} from '@athlete/contracts';
import { AthletesService } from './athletes.service';
import { Authorize } from '../../common/authz/authorize.decorator';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { formatETag, parseIfMatch } from '../../common/http/optimistic-concurrency';

/** Thin by design: HTTP concerns and validation only, no business rules. */
@Controller('athletes')
export class AthletesController {
  constructor(private readonly athletes: AthletesService) {}

  @Get()
  @Authorize({ roles: ['academy_admin', 'coach'] })
  list(): Promise<AthleteResponse[]> {
    return this.athletes.list();
  }

  @Get(':id')
  @Authorize({ roles: ['academy_admin', 'coach'] })
  async getById(
    @Param('id', new ZodValidationPipe(Uuid)) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AthleteResponse> {
    const athlete = await this.athletes.getById(id);
    response.setHeader('ETag', formatETag(athlete.version));
    return athlete;
  }

  @Post()
  @Authorize({ roles: ['academy_admin'] })
  async create(
    @Body(new ZodValidationPipe(CreateAthleteRequest)) body: CreateAthleteRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AthleteResponse> {
    const athlete = await this.athletes.create(body);
    response.setHeader('ETag', formatETag(athlete.version));
    return athlete;
  }

  @Patch(':id')
  @Authorize({ roles: ['academy_admin', 'coach'] })
  async update(
    @Param('id', new ZodValidationPipe(Uuid)) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(UpdateAthleteRequest)) body: UpdateAthleteRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AthleteResponse> {
    const athlete = await this.athletes.update(id, parseIfMatch(ifMatch), body);
    response.setHeader('ETag', formatETag(athlete.version));
    return athlete;
  }
}
