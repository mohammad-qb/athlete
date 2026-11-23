import 'reflect-metadata';
import {
  Controller,
  Get,
  Logger,
  Module,
  Patch,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { strictObject } from '@athlete/contracts';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ErrorResponder } from '../src/common/errors/error-responder';
import { AllExceptionsFilter } from '../src/common/errors/filters/all-exceptions.filter';
import { ApiErrorFilter } from '../src/common/errors/filters/api-error.filter';
import { HttpExceptionFilter } from '../src/common/errors/filters/http-exception.filter';
import {
  Validate,
  ValidBody,
  ValidParams,
  ValidQuery,
} from '../src/common/validation/validate.decorator';
import { ValidationInterceptor } from '../src/common/validation/validation.interceptor';

/**
 * PROVES: validation actually runs on a request, over real HTTP.
 *
 * The route manifest proves every route DECLARES a schema. That is metadata; it says
 * nothing about whether an interceptor is registered, whether the parsed value is the
 * one the handler receives, or what happens to a route that declares nothing. Those
 * are wiring questions, so they are asked of a running Nest application: the real
 * interceptor, the real filters, Express, and a socket.
 *
 * No database: the controller below is a fixture.
 */
const Params = strictObject({ id: z.guid() });
const Query = strictObject({ limit: z.coerce.number().int().min(1).max(100).default(20) });
const Body = strictObject({
  name: z.string().min(1),
  schedule: strictObject({ timezone: z.string().min(1) }),
});

const handled = vi.fn();

/** Keeps the responder's output off the console and available to assert on. */
function captureLogs() {
  const lines: string[] = [];
  const record = (...parts: unknown[]) => void lines.push(parts.map(String).join('\n'));
  const spies = (['error', 'warn', 'log', 'debug'] as const).map((level) =>
    vi.spyOn(Logger.prototype, level).mockImplementation(record),
  );
  return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

@Controller('things')
class ThingsController {
  @Post(':id')
  @Validate({ params: Params, query: Query, body: Body })
  create(
    @ValidParams('id') id: string,
    @ValidQuery() query: z.infer<typeof Query>,
    @ValidBody() body: z.infer<typeof Body>,
  ) {
    handled();
    return { id, query, body };
  }

  /** The mistake this layer exists for: reads the body, declares nothing. */
  @Patch('forgot-everything')
  forgotEverything(@ValidBody() body: unknown) {
    handled();
    return { body };
  }

  /** Declares one slot, reads another. */
  @Get('forgot-query/:id')
  @Validate({ params: Params })
  forgotQuery(@ValidParams('id') id: string, @ValidQuery() query: unknown) {
    handled();
    return { id, query };
  }
}

/**
 * The same providers `AppModule` registers, in the same order, built by factory:
 * Vitest compiles with esbuild, which emits no decorator metadata, so Nest cannot
 * resolve constructor parameters by type here as it does in the compiled application.
 * That the compiled application wires them is the smoke script's claim.
 */
@Module({
  controllers: [ThingsController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new ValidationInterceptor(reflector),
      inject: [Reflector],
    },
    ErrorResponder,
    ...[AllExceptionsFilter, HttpExceptionFilter, ApiErrorFilter].map((Filter) => ({
      provide: APP_FILTER,
      useFactory: (responder: ErrorResponder) => new Filter(responder),
      inject: [ErrorResponder],
    })),
  ],
})
class FixtureModule {}

const ID = '11111111-1111-4111-8111-111111111111';
const VALID_BODY = { name: 'U14', schedule: { timezone: 'Asia/Amman' } };

describe('validation over HTTP', () => {
  let app: INestApplication;
  let logs: ReturnType<typeof captureLogs>;

  beforeAll(async () => {
    logs = captureLogs();
    const moduleRef = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterEach(() => {
    handled.mockClear();
    logs.lines.length = 0;
  });
  afterAll(async () => {
    await app.close();
    logs.restore();
  });

  const http = () => request(app.getHttpServer() as Parameters<typeof request>[0]);

  it('hands the handler the PARSED values, not the raw request', async () => {
    const response = await http().post(`/things/${ID}?limit=5`).send(VALID_BODY).expect(201);

    // `limit` arrived as the string "5" and reaches the handler as a number: the
    // handler is reading the schema's output.
    expect(response.body).toEqual({ id: ID, query: { limit: 5 }, body: VALID_BODY });
  });

  it('applies schema defaults, which only exist in parsed output', async () => {
    const response = await http().post(`/things/${ID}`).send(VALID_BODY).expect(201);
    expect((response.body as { query: unknown }).query).toEqual({ limit: 20 });
  });

  it('refuses an invalid body with a VALIDATION error naming the field by dot path', async () => {
    const response = await http()
      .post(`/things/${ID}`)
      .send({ name: 'U14', schedule: { timezone: '' } })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      type: 'VALIDATION',
      code: 'validation_failed',
      message: 'Request validation failed',
    });
    expect((response.body as { meta: unknown }).meta).toEqual({
      fields: [{ in: 'body', path: 'schedule.timezone', messages: [expect.any(String)] }],
    });
    expect(handled).not.toHaveBeenCalled();
  });

  it('refuses an unknown key instead of stripping it', async () => {
    const response = await http()
      .post(`/things/${ID}`)
      .send({ ...VALID_BODY, nmae: 'typo', schedule: { timezone: 'UTC', tz: 'x' } })
      .expect(400);

    const { fields } = (response.body as { meta: { fields: { path: string }[] } }).meta;
    expect([...fields].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { in: 'body', path: 'nmae', messages: ['Unrecognized field'] },
      { in: 'body', path: 'schedule.tz', messages: ['Unrecognized field'] },
    ]);
    expect(handled).not.toHaveBeenCalled();
  });

  it('reports every failing part of the request in one response', async () => {
    const response = await http().post('/things/not-a-uuid?limit=0&page=2').send({}).expect(400);

    const fields = (response.body as { meta: { fields: { in: string; path: string }[] } }).meta
      .fields;
    // Slots are reported in a fixed order (params, query, body); order within one is Zod's.
    expect(fields.map((field) => field.in)).toEqual(['params', 'query', 'query', 'body', 'body']);
    expect(fields.map((field) => `${field.in}:${field.path}`).sort()).toEqual([
      'body:name',
      'body:schedule',
      'params:id',
      'query:limit',
      'query:page',
    ]);
  });

  it('refuses a missing body', async () => {
    const response = await http().post(`/things/${ID}`).expect(400);
    expect((response.body as { type: string }).type).toBe('VALIDATION');
  });

  /**
   * The fail-closed half. Delete the `@Validate` from a real route and this is what
   * its callers get: not the raw body, a refusal.
   */
  it('refuses a route that reads the body without declaring a schema', async () => {
    const response = await http().patch('/things/forgot-everything').send({ anything: 1 }).expect(500);

    expect(response.body).toMatchObject({
      type: 'INTERNAL',
      code: 'validation_not_declared',
      message: 'Internal server error',
    });
    expect(handled).not.toHaveBeenCalled();
    // The client is told nothing; whoever reads the log is told exactly what to add.
    expect(JSON.stringify(response.body)).not.toContain('forgotEverything');
    expect(logs.lines.join('\n')).toContain(
      'ThingsController.forgotEverything reads the request body but declares no schema for it',
    );
  });

  it('refuses a slot that was not declared even when another one was', async () => {
    const response = await http().get(`/things/forgot-query/${ID}?limit=5`).expect(500);

    expect((response.body as { code: string }).code).toBe('validation_not_declared');
    expect(handled).not.toHaveBeenCalled();
  });
});
