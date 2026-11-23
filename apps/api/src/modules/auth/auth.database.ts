import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * The `athlete_auth` connection pool: the only connections in the API that can read a
 * password hash or a session token. Kept apart from `DatabaseService` so that no
 * request handler's query can be issued on one by accident -- a repository is given
 * the tenant transaction, never this.
 *
 * Small on purpose. A request costs at most one session read here, plus the occasional
 * write when a session is refreshed or switches academy.
 */
@Injectable()
export class AuthDatabase implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(connectionString: string, maxConnections = 5) {
    this.pool = new Pool({ connectionString, max: maxConnections });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
