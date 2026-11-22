import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/errors/api.error';
import { OriginGuard } from '../src/common/http/origin.guard';

/**
 * PROVES: a state-changing request that names another origin is refused before a
 * cookie is read, and nothing else is.
 */
const guard = new OriginGuard('https://app.example.test/some/path');

function contextFor(method: string, origin?: string): ExecutionContext {
  const request = { method, headers: origin === undefined ? {} : { origin } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function refusal(method: string, origin: string): ApiError {
  try {
    guard.canActivate(contextFor(method, origin));
  } catch (error) {
    return error as ApiError;
  }
  throw new Error(`${method} from ${origin} was admitted`);
}

describe('OriginGuard', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('refuses %s from a foreign origin', (method) => {
    const error = refusal(method, 'https://evil.example');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('invalid_origin');
  });

  it('admits the application origin, taken from the base URL without its path', () => {
    expect(guard.canActivate(contextFor('POST', 'https://app.example.test'))).toBe(true);
  });

  it('admits a request with no Origin header: not a browser, so no ambient cookie', () => {
    expect(guard.canActivate(contextFor('POST'))).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('never refuses %s, whatever the origin', (method) => {
    expect(guard.canActivate(contextFor(method, 'https://evil.example'))).toBe(true);
  });

  it.each([
    ['another scheme', 'http://app.example.test'],
    ['another port', 'https://app.example.test:8443'],
    ['a subdomain', 'https://evil.app.example.test'],
    ['a lookalike suffix', 'https://app.example.test.evil.example'],
    ['the opaque origin of a sandboxed frame', 'null'],
    ['an empty header', ''],
  ])('compares the whole origin: %s is foreign', (_label, origin) => {
    expect(refusal('POST', origin).code).toBe('invalid_origin');
  });
});
