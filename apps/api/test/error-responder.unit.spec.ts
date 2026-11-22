import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiErrorType } from '../src/common/errors/api.error';
import { ErrorResponder } from '../src/common/errors/error-responder';
import { AllExceptionsFilter } from '../src/common/errors/filters/all-exceptions.filter';
import { ApiErrorFilter } from '../src/common/errors/filters/api-error.filter';
import { HttpExceptionFilter } from '../src/common/errors/filters/http-exception.filter';
import type { ApiErrorResponse } from '../src/common/errors/api.error';

/**
 * PROVES: every thrown value becomes one wire shape, and an unexpected error's own
 * message never reaches the client.
 *
 * The redaction assertions are the load-bearing ones. `pg` puts the failing SQL and
 * the role name into its error messages, so a filter that forwarded `error.message`
 * for an unclassified failure would publish schema detail and connection identities to
 * anyone who could provoke a 500. There is no type that catches that; only a test does.
 */
function fakeResponse(headersSent = false) {
  const response = {
    headersSent,
    statusCode: undefined as number | undefined,
    body: undefined as ApiErrorResponse | undefined,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: ApiErrorResponse) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { response, host };
}

/** Everything the responder logged, by level, as one flat list of lines. */
function captureLogs() {
  const lines: { level: string; line: string; stack?: string }[] = [];
  const record = (level: string) =>
    // Nest's Logger.error takes the stack trace as its second argument; the other
    // levels take trailing context. Only the string form is of interest here.
    vi.fn((line: unknown, stack?: unknown) => {
      lines.push({
        level,
        line: String(line),
        stack: typeof stack === 'string' ? stack : undefined,
      });
    });
  vi.spyOn(Logger.prototype, 'error').mockImplementation(record('error'));
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(record('warn'));
  vi.spyOn(Logger.prototype, 'log').mockImplementation(record('log'));
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(record('debug'));
  return lines;
}

describe('ErrorResponder', () => {
  let logs: { level: string; line: string; stack?: string }[];
  let responder: ErrorResponder;

  beforeEach(() => {
    logs = captureLogs();
    responder = new ErrorResponder();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the serialised error at its own status', () => {
    const { response, host } = fakeResponse();
    responder.respond(
      new ApiError('Athlete not found', { type: ApiErrorType.NOT_FOUND }),
      host,
    );

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ type: 'NOT_FOUND', message: 'Athlete not found' });
  });

  it('logs exactly once, at the severity the error carries', () => {
    const { host } = fakeResponse();
    responder.respond(new ApiError('nope', { type: ApiErrorType.FORBIDDEN }), host);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('warn');
    expect(logs[0]?.line).toContain('http.request.failed');
  });

  /**
   * The shape every database failure actually arrives in. Drizzle wraps the driver
   * error in a `DrizzleQueryError` whose message is the SQL and its parameters, and
   * attaches the `pg` error as ITS cause -- so the step that names the violated
   * constraint is two deep. It captures its own stack, so that message is in no stack
   * either. Logging one level means a line that says a query failed without saying why.
   */
  it('logs the whole cause chain, not just its first step', () => {
    const driverError = Object.assign(
      new Error('duplicate key value violates unique constraint "athletes_pkey"'),
      { name: 'error', code: '23505' },
    );
    const wrapped = Object.assign(
      new Error('Failed query: insert into "athletes" ...'),
      { name: 'DrizzleQueryError', cause: driverError },
    );

    const { host } = fakeResponse();
    responder.respond(
      new ApiError('Internal server error', {
        type: ApiErrorType.DATABASE,
        cause: wrapped,
      }),
      host,
    );

    expect(logs[0]?.line).toContain('Failed query');
    // The diagnosis worth having.
    expect(logs[0]?.line).toContain('athletes_pkey');
    expect(logs[0]?.line).toContain('<-');
  });

  it('survives a self-referential cause instead of hanging the error path', () => {
    const a = new Error('outer');
    const b = new Error('inner');
    a.cause = b;
    b.cause = a;

    const { host } = fakeResponse();
    responder.respond(
      new ApiError('Internal server error', { type: ApiErrorType.INTERNAL, cause: a }),
      host,
    );

    expect(logs[0]?.line).toContain('outer');
    expect(logs[0]?.line).toContain('inner');
  });

  it('stops the walk at a cause that is not an Error', () => {
    const outer = Object.assign(new Error('wrapper'), { cause: 'a bare string' });

    const { host } = fakeResponse();
    responder.respond(
      new ApiError('Internal server error', { type: ApiErrorType.INTERNAL, cause: outer }),
      host,
    );

    expect(logs[0]?.line).toContain('wrapper');
    expect(logs[0]?.line).not.toContain('a bare string');
  });

  it('logs a 5xx at error level with the cause for correlation', () => {
    const { host } = fakeResponse();
    responder.respond(
      new ApiError('Internal server error', {
        type: ApiErrorType.DATABASE,
        cause: new Error('relation athletes does not exist'),
      }),
      host,
    );

    expect(logs[0]?.level).toBe('error');
    expect(logs[0]?.line).toContain('relation athletes does not exist');
  });

  /**
   * `meta` on a 4xx echoes client input -- a rejected field value, an unparseable
   * header. It is on the wire because the caller sent it, but putting it in the log
   * means retaining someone else's data for every malformed request.
   */
  it('logs meta for a 5xx and withholds it for a 4xx', () => {
    const { host } = fakeResponse();

    responder.respond(
      new ApiError('Upstream failed', {
        type: ApiErrorType.INTERNAL,
        meta: { provider: 'postgres', attempt: 3 },
      }),
      host,
    );
    expect(logs[0]?.line).toContain('provider');

    logs.length = 0;
    responder.respond(
      new ApiError('Malformed If-Match value', {
        type: ApiErrorType.BAD_REQUEST,
        meta: { ifMatch: 'surname@example.com' },
      }),
      host,
    );
    expect(logs[0]?.line).not.toContain('surname@example.com');
  });

  /**
   * An error thrown after the response has begun cannot be given a body: the status
   * line is already on the wire and writing a second one throws, turning a handled
   * failure into a crash.
   */
  it('closes the connection instead of writing a body when headers are already sent', () => {
    const { response, host } = fakeResponse(true);
    responder.respond(new ApiError('too late', { type: ApiErrorType.INTERNAL }), host);

    expect(response.ended).toBe(true);
    expect(response.statusCode).toBeUndefined();
    expect(response.body).toBeUndefined();
    // Still logged: the failure happened whether or not the client can be told.
    expect(logs).toHaveLength(1);
  });
});

describe('ApiErrorFilter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes an ApiError through unchanged', () => {
    captureLogs();
    const { response, host } = fakeResponse();
    new ApiErrorFilter(new ErrorResponder()).catch(
      new ApiError('Athlete was modified by someone else', {
        type: ApiErrorType.CONFLICT,
        code: 'stale_write',
        meta: { expectedVersion: 2 },
      }),
      host,
    );

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      type: 'CONFLICT',
      code: 'stale_write',
      meta: { expectedVersion: 2 },
    });
  });
});

describe('HttpExceptionFilter', () => {
  afterEach(() => vi.restoreAllMocks());

  function normalise(exception: HttpException) {
    captureLogs();
    const { response, host } = fakeResponse();
    new HttpExceptionFilter(new ErrorResponder()).catch(exception, host);
    return response;
  }

  /**
   * This is what lets the codebase migrate to ApiError incrementally without the API
   * speaking two dialects: a service still throwing NotFoundException produces the
   * same body as one throwing ApiError.
   */
  it('gives a Nest exception the same body an equivalent ApiError would have', () => {
    const response = normalise(new NotFoundException('Athlete 44 not found'));

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      type: 'NOT_FOUND',
      message: 'Athlete 44 not found',
    });
  });

  /**
   * An HttpException's payload is whatever object its thrower passed, and nothing marks
   * it as meant for the client. Only `message` is published; structured detail reaches
   * the wire through ApiError's `meta` or not at all.
   */
  it('publishes the message of a 4xx and none of the rest of its payload', () => {
    const response = normalise(
      new BadRequestException({
        message: 'Tenant mismatch',
        tenantId: '7d0c0f0e-0000-4000-8000-000000000001',
        resolvedFrom: 'x-internal-routing',
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(response.body?.message).toBe('Tenant mismatch');
    expect(response.body?.meta).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('x-internal-routing');
  });

  it('joins an array message rather than degrading to the class name', () => {
    const response = normalise(
      new BadRequestException({ message: ['firstName is required', 'lastName is required'] }),
    );
    expect(response.body?.message).toBe('firstName is required; lastName is required');
  });

  it('preserves a status the taxonomy has no type for, labelling it by class', () => {
    const response = normalise(new HttpException('Teapot', 418));
    expect(response.statusCode).toBe(418);
    expect(response.body?.type).toBe('BAD_REQUEST');
  });

  /**
   * Choosing a 5xx `HttpException` says what the status is, not that the message is
   * fit to publish -- and Nest's own filter publishes it regardless. A 500 must come
   * out of this filter looking exactly like a 500 out of the catch-all, or the leak is
   * just one `throw` away.
   */
  it('redacts a 5xx exactly as the catch-all does, keeping the detail in the log', () => {
    const logs = captureLogs();
    const { response, host } = fakeResponse();
    new HttpExceptionFilter(new ErrorResponder()).catch(
      new InternalServerErrorException('relation athletes does not exist'),
      host,
    );

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      message: 'Internal server error',
      type: 'INTERNAL',
    });
    expect(JSON.stringify(response.body)).not.toContain('athletes');

    expect(logs[0]?.level).toBe('error');
    expect(logs[0]?.line).toContain('relation athletes does not exist');
  });

  /** The thrower's structured payload is internal state for a 5xx; the log keeps it. */
  it('withholds the payload of a 5xx from meta', () => {
    captureLogs();
    const { response, host } = fakeResponse();
    new HttpExceptionFilter(new ErrorResponder()).catch(
      new HttpException({ message: 'Upstream refused', host: '10.0.0.4:5432' }, 503),
      host,
    );

    expect(response.statusCode).toBe(503);
    expect(response.body?.message).toBe('Internal server error');
    expect(response.body?.meta).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.4');
  });
});

describe('AllExceptionsFilter', () => {
  let logs: { level: string; line: string; stack?: string }[];

  beforeEach(() => {
    logs = captureLogs();
  });
  afterEach(() => vi.restoreAllMocks());

  function normalise(exception: unknown) {
    const { response, host } = fakeResponse();
    new AllExceptionsFilter(new ErrorResponder()).catch(exception, host);
    return response;
  }

  it('redacts an unexpected error: the message reaches the log and nothing else', () => {
    const response = normalise(
      new Error('insert into "athletes" failed: duplicate key value violates "athletes_pkey"'),
    );

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      message: 'Internal server error',
      type: 'INTERNAL',
    });
    expect(JSON.stringify(response.body)).not.toContain('athletes_pkey');

    expect(logs[0]?.level).toBe('error');
    expect(logs[0]?.line).toContain('athletes_pkey');
    // The cause's stack is logged, so the trace points at the throw site rather than
    // at the filter that wrapped it.
    expect(logs[0]?.stack).toContain('athletes_pkey');
  });

  /**
   * body-parser's 413 arrives here, not at the HttpException filter: Express
   * middleware throws before Nest routing, and Nest only converts SyntaxError and
   * URIError. Without this branch an oversized upload would be reported as a server
   * fault.
   */
  it('keeps the status and message of an http-errors 4xx that marked itself exposable', () => {
    const payloadTooLarge = Object.assign(new Error('request entity too large'), {
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      expose: true,
    });

    const response = normalise(payloadTooLarge);
    expect(response.statusCode).toBe(413);
    expect(response.body?.message).toBe('request entity too large');
  });

  it('redacts an http-errors 5xx even when it claims to be exposable', () => {
    const response = normalise(
      Object.assign(new Error('upstream pool exhausted at 10.0.0.4:5432'), {
        statusCode: 502,
        expose: true,
      }),
    );

    expect(response.statusCode).toBe(502);
    expect(response.body?.message).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.4');
  });

  it('fails closed for a status-carrying error that never marked itself safe', () => {
    const response = normalise(Object.assign(new Error('secret detail'), { status: 403 }));

    expect(response.statusCode).toBe(403);
    expect(response.body?.message).toBe('Request failed');
  });

  /**
   * Nest's own isHttpError accepts any numeric status, which would let an arbitrary
   * error nominate itself a success and produce a 200 with an error body.
   */
  it('ignores a status outside the error range rather than letting it pick a 2xx', () => {
    const response = normalise(Object.assign(new Error('nope'), { statusCode: 200 }));
    expect(response.statusCode).toBe(500);
  });

  it('wraps a thrown non-Error so the value still reaches the log', () => {
    const response = normalise('just a string');

    expect(response.statusCode).toBe(500);
    expect(response.body?.message).toBe('Internal server error');
    expect(logs[0]?.line).toContain('just a string');
  });
});
