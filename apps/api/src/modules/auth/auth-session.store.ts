import { Injectable } from '@nestjs/common';
import { AuthDatabase } from './auth.database';

/**
 * The ONLY code that writes `auth_sessions.active_academy_id`.
 *
 * better-auth is told the field exists with `input: false`, so no route of the
 * library's accepts it from a browser; this is the server-side write that remains. It
 * runs on the auth pool because the application role holds nothing on `auth_sessions`.
 *
 * Callers decide WHETHER the user may act in the academy (they hold a role there);
 * this only records the answer. `updated_at` is left alone: it is better-auth's own
 * bookkeeping for the session row.
 */
@Injectable()
export class AuthSessionStore {
  constructor(private readonly database: AuthDatabase) {}

  async setActiveAcademy(sessionId: string, academyId: string): Promise<void> {
    await this.database.pool.query(
      'update auth_sessions set active_academy_id = $2 where id = $1',
      [sessionId, academyId],
    );
  }
}
