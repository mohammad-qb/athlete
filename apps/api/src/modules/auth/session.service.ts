import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Role, Uuid } from '@athlete/contracts';
import { z } from 'zod';
import type { Principal } from '../../common/tenancy/request-context';

const TokenPayload = z.object({
  sub: Uuid,
  aid: Uuid,
  roles: z.array(Role),
  exp: z.number().int(),
});

/**
 * Session token verification for this slice.
 *
 * SCOPE NOTE, stated plainly: the production design keeps users, credentials and
 * refresh-rotated sessions in this same Postgres via a maintained auth library
 * (argon2id hashing, httpOnly cookies, TOTP). That is deliberately NOT re-implemented
 * here -- the slice exists to prove tenancy, temporal history, concurrency and
 * authorization, and hand-rolling credential storage to pad a case study would be the
 * wrong signal. What is implemented is stateless token verification, so the
 * authorization and tenancy paths are exercised end to end with a real principal.
 */
@Injectable()
export class SessionService {
  constructor(private readonly secret: string) {}

  issue(principal: Principal, ttlSeconds = 3600): string {
    const payload = {
      sub: principal.userId,
      aid: principal.academyId,
      roles: principal.roles,
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  verify(token: string): Principal | null {
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;

    const expected = this.sign(body);
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    const parsed = TokenPayload.safeParse(decoded);
    if (!parsed.success) return null;
    if (parsed.data.exp <= Math.floor(Date.now() / 1000)) return null;

    return {
      userId: parsed.data.sub,
      academyId: parsed.data.aid,
      roles: parsed.data.roles,
    };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
