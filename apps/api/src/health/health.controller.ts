import { Controller, Get } from '@nestjs/common';
import { HealthResponse } from '@athlete/contracts';
import { Public } from '../common/authz/permission.decorator';
import { Responds } from '../common/validation/responds.decorator';

@Controller('health')
export class HealthController {
  /**
   * Liveness only -- deliberately does not touch the database. A health endpoint that
   * fails when Postgres blips causes the platform to restart healthy containers during
   * a database incident, turning a degradation into an outage.
   */
  @Get()
  @Public()
  @Responds(HealthResponse)
  live(): HealthResponse {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }
}
