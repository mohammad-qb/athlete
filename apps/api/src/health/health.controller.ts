import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/authz/permission.decorator';

@Controller('health')
export class HealthController {
  /**
   * Liveness only -- deliberately does not touch the database. A health endpoint that
   * fails when Postgres blips causes the platform to restart healthy containers during
   * a database incident, turning a degradation into an outage.
   */
  @Get()
  @Public()
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }
}
