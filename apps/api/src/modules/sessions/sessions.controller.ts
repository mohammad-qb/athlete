import { Controller, Get, Post } from '@nestjs/common';
import {
  CreateSessionRequest,
  IdParams,
  RecordAttendanceRequest,
  RegisterResponse,
  SessionListQuery,
  SessionPage,
  SessionResponse,
} from '@athlete/contracts';
import { SessionsService } from './sessions.service';
import { Permission } from '../../common/authz/permission.decorator';
import { Responds } from '../../common/validation/responds.decorator';
import {
  Validate,
  ValidBody,
  ValidParams,
  ValidQuery,
} from '../../common/validation/validate.decorator';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @Permission({ action: 'read', subject: 'trainingSessions' })
  @Validate({ query: SessionListQuery })
  @Responds(SessionPage)
  list(@ValidQuery() query: SessionListQuery): Promise<SessionPage> {
    return this.sessions.listSessions(query);
  }

  @Post()
  @Permission({ action: 'create', subject: 'trainingSessions' })
  @Validate({ body: CreateSessionRequest })
  @Responds(SessionResponse)
  create(@ValidBody() body: CreateSessionRequest): Promise<SessionResponse> {
    return this.sessions.createSession(body);
  }

  /** So the attendance page can be opened by its URL: which team, and when. */
  @Get(':id')
  @Permission({ action: 'read', subject: 'trainingSessions' })
  @Validate({ params: IdParams })
  @Responds(SessionResponse)
  getById(@ValidParams('id') id: string): Promise<SessionResponse> {
    return this.sessions.getSession(id);
  }

  @Post(':id/attendance')
  @Permission({ action: 'create', subject: 'sessionParticipants' })
  @Validate({ params: IdParams, body: RecordAttendanceRequest })
  @Responds(RegisterResponse)
  recordAttendance(
    @ValidParams('id') sessionId: string,
    @ValidBody() body: RecordAttendanceRequest,
  ): Promise<RegisterResponse> {
    return this.sessions.recordAttendance(sessionId, body);
  }

  @Get(':id/attendance')
  @Permission({ action: 'read', subject: 'sessionParticipants' })
  @Validate({ params: IdParams })
  @Responds(RegisterResponse)
  register(@ValidParams('id') sessionId: string): Promise<RegisterResponse> {
    return this.sessions.register(sessionId);
  }
}
