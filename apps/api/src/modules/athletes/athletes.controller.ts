import { Controller, Get, Patch, Post } from '@nestjs/common';
import {
  AthleteListQuery,
  AthletePage,
  AthleteResponse,
  CreateAthleteRequest,
  IdParams,
  UpdateAthleteRequest,
} from '@athlete/contracts';
import { AthletesService } from './athletes.service';
import { Permission } from '../../common/authz/permission.decorator';
import { IfMatch } from '../../common/http/if-match.decorator';
import { Responds } from '../../common/validation/responds.decorator';
import {
  Validate,
  ValidBody,
  ValidParams,
  ValidQuery,
} from '../../common/validation/validate.decorator';

/**
 * Thin by design: HTTP concerns and validation only, no business rules.
 *
 * `etag: true` sends the encoded body's `version` as `ETag`; `@IfMatch()` requires it
 * back. Both are declarations, so the OpenAPI document lists the two headers on exactly
 * the routes that use them.
 */
@Controller('athletes')
export class AthletesController {
  constructor(private readonly athletes: AthletesService) {}

  @Get()
  @Permission({ action: 'read', subject: 'athletes' })
  @Validate({ query: AthleteListQuery })
  @Responds(AthletePage)
  list(@ValidQuery() query: AthleteListQuery): Promise<AthletePage> {
    return this.athletes.list(query);
  }

  @Get(':id')
  @Permission({ action: 'read', subject: 'athletes' })
  @Validate({ params: IdParams })
  @Responds(AthleteResponse, { etag: true })
  getById(@ValidParams('id') id: string): Promise<AthleteResponse> {
    return this.athletes.getById(id);
  }

  @Post()
  @Permission({ action: 'create', subject: 'athletes' })
  @Validate({ body: CreateAthleteRequest })
  @Responds(AthleteResponse, { etag: true })
  create(@ValidBody() body: CreateAthleteRequest): Promise<AthleteResponse> {
    return this.athletes.create(body);
  }

  @Patch(':id')
  @Permission({ action: 'update', subject: 'athletes' })
  @Validate({ params: IdParams, body: UpdateAthleteRequest })
  @Responds(AthleteResponse, { etag: true })
  update(
    @ValidParams('id') id: string,
    @IfMatch() expectedVersion: number,
    @ValidBody() body: UpdateAthleteRequest,
  ): Promise<AthleteResponse> {
    return this.athletes.update(id, expectedVersion, body);
  }
}
