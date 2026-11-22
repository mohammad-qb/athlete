import { loadEnv } from '@athlete/config';
import { describe, expect, it } from 'vitest';

/**
 * PROVES: the list of trusted proxies is parsed strictly. It decides whose sign-in
 * attempts are counted together, so a typo must stop the boot, not widen or void it.
 */
const base = {
  DATABASE_URL: 'postgres://athlete_app:x@localhost:5432/athlete',
  AUTH_DATABASE_URL: 'postgres://athlete_auth:x@localhost:5432/athlete',
  APP_BASE_URL: 'http://localhost:3000',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('AUTH_TRUSTED_PROXIES', () => {
  it('is empty when unset or blank: the API is reached directly', () => {
    expect(loadEnv(base).AUTH_TRUSTED_PROXIES).toEqual([]);
    expect(loadEnv({ ...base, AUTH_TRUSTED_PROXIES: ' ' }).AUTH_TRUSTED_PROXIES).toEqual([]);
  });

  it('accepts IPs and CIDR ranges of both families, trimmed', () => {
    const env = loadEnv({
      ...base,
      AUTH_TRUSTED_PROXIES: '198.51.100.20, 10.9.0.0/16 ,2a01:111:2050::/44,::1,',
    });
    expect(env.AUTH_TRUSTED_PROXIES).toEqual(['198.51.100.20', '10.9.0.0/16', '2a01:111:2050::/44', '::1']);
  });

  it.each(['10.9.0.0/33', 'frontdoor', '10.9.0', '10.9.0.0/16;10.8.0.0/16'])(
    'refuses to boot on a malformed entry: %s',
    (entry) => {
      expect(() => loadEnv({ ...base, AUTH_TRUSTED_PROXIES: `198.51.100.20,${entry}` })).toThrow(
        /AUTH_TRUSTED_PROXIES/,
      );
    },
  );
});
