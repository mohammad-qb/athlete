import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { SwitchAcademyRequest, type MeResponse } from '@athlete/contracts';
import { Authenticated } from '../../common/authz/permission.decorator';
import { Validate, ValidBody } from '../../common/validation/validate.decorator';
import { CurrentSession, type CurrentSessionValue } from './current-session.decorator';
import { MeService } from './me.service';

/**
 * Routes about the caller. `@Authenticated`, not `@Permission`: there is no resource
 * here to hold a permission on, and an account with no academy must still be able to
 * ask who it is.
 */
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @Authenticated()
  read(@CurrentSession() session: CurrentSessionValue): MeResponse {
    return this.me.describe(session);
  }

  /** 200, not Nest's default 201 for a POST: nothing is created, the session moves. */
  @Post('active-academy')
  @HttpCode(200)
  @Authenticated()
  @Validate({ body: SwitchAcademyRequest })
  switchAcademy(
    @CurrentSession() session: CurrentSessionValue,
    @ValidBody() body: SwitchAcademyRequest,
  ): Promise<MeResponse> {
    return this.me.switchAcademy(session, body.academyId);
  }
}
