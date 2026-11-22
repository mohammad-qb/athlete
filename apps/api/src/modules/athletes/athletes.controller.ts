import { Controller, Get, Headers, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateAthleteRequest,
  IdParams,
  UpdateAthleteRequest,
  type AthleteResponse,
} from '@athlete/contracts';
import { AthletesService } from './athletes.service';
import { Permission } from '../../common/authz/permission.decorator';
import { formatETag, parseIfMatch } from '../../common/http/optimistic-concurrency';
import { Validate, ValidBody, ValidParams } from '../../common/validation/validate.decorator';

/** Thin by design: HTTP concerns and validation only, no business rules. */
@Controller('athletes')
export class AthletesController {
  constructor(private readonly athletes: AthletesService) {}

  @Get()
  @Permission({ action: 'read', subject: 'athletes' })
  list(): Promise<AthleteResponse[]> {
    return this.athletes.list();
  }

  @Get(':id')
  @Permission({ action: 'read', subject: 'athletes' })
  @Validate({ params: IdParams })
  async getById(
    @ValidParams('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AthleteResponse> {
    const athlete = await this.athletes.getById(id);
    response.setHeader('ETag', formatETag(athlete.version));
    return athlete;
  }

  @Post()
  @Permission({ action: 'create', subject: 'athletes' })
  @Validate({ body: CreateAthleteRequest })
  async create(
    @ValidBody() body: CreateAthleteRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AthleteResponse> {
    const athlete = await this.athletes.create(body);
    response.setHeader('ETag', formatETag(athlete.version));
    return athlete;
  }

  @Patch(':id')
  @Permission({ action: 'update', subject: 'athletes' })
  @Validate({ params: IdParams, body: UpdateAthleteRequest })
  async update(
    @ValidParams('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @ValidBody() body: UpdateAthleteRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AthleteResponse> {
    const athlete = await this.athletes.update(id, parseIfMatch(ifMatch), body);
    response.setHeader('ETag', formatETag(athlete.version));
    return athlete;
  }
}
