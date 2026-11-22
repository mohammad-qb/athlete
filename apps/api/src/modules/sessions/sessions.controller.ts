import { Controller, Get, Post } from '@nestjs/common';
import {
  CreateSessionRequest,
  IdParams,
  RecordAttendanceRequest,
  type ParticipationResponse,
  type SessionResponse,
} from '@athlete/contracts';
import { SessionsService } from './sessions.service';
import { Permission } from '../../common/authz/permission.decorator';
import { Validate, ValidBody, ValidParams } from '../../common/validation/validate.decorator';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @Permission({ action: 'create', subject: 'trainingSessions' })
  @Validate({ body: CreateSessionRequest })
  create(@ValidBody() body: CreateSessionRequest): Promise<SessionResponse> {
    return this.sessions.createSession(body);
  }

  @Post(':id/attendance')
  @Permission({ action: 'create', subject: 'sessionParticipants' })
  @Validate({ params: IdParams, body: RecordAttendanceRequest })
  recordAttendance(
    @ValidParams('id') sessionId: string,
    @ValidBody() body: RecordAttendanceRequest,
  ): Promise<ParticipationResponse[]> {
    return this.sessions.recordAttendance(sessionId, body);
  }

  @Get(':id/attendance')
  @Permission({ action: 'read', subject: 'sessionParticipants' })
  @Validate({ params: IdParams })
  register(@ValidParams('id') sessionId: string): Promise<ParticipationResponse[]> {
    return this.sessions.register(sessionId);
  }
}
