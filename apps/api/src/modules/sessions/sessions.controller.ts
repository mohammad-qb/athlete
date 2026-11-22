import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  CreateSessionRequest,
  RecordAttendanceRequest,
  type ParticipationResponse,
  type SessionResponse,
  Uuid,
} from '@athlete/contracts';
import { SessionsService } from './sessions.service';
import { Permission } from '../../common/authz/permission.decorator';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @Permission({ action: 'create', subject: 'trainingSessions' })
  create(
    @Body(new ZodValidationPipe(CreateSessionRequest)) body: CreateSessionRequest,
  ): Promise<SessionResponse> {
    return this.sessions.createSession(body);
  }

  @Post(':id/attendance')
  @Permission({ action: 'create', subject: 'sessionParticipants' })
  recordAttendance(
    @Param('id', new ZodValidationPipe(Uuid)) sessionId: string,
    @Body(new ZodValidationPipe(RecordAttendanceRequest)) body: RecordAttendanceRequest,
  ): Promise<ParticipationResponse[]> {
    return this.sessions.recordAttendance(sessionId, body);
  }

  @Get(':id/attendance')
  @Permission({ action: 'read', subject: 'sessionParticipants' })
  register(@Param('id', new ZodValidationPipe(Uuid)) sessionId: string): Promise<ParticipationResponse[]> {
    return this.sessions.register(sessionId);
  }
}
