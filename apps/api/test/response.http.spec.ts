import 'reflect-metadata';
import { Controller, Get, Logger, Module, Patch, Post, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ErrorResponder } from '../src/common/errors/error-responder';
import { AllExceptionsFilter } from '../src/common/errors/filters/all-exceptions.filter';
import { ApiErrorFilter } from '../src/common/errors/filters/api-error.filter';
import { HttpExceptionFilter } from '../src/common/errors/filters/http-exception.filter';
import { IfMatch } from '../src/common/http/if-match.decorator';
import { Responds } from '../src/common/validation/responds.decorator';
import { ResponseInterceptor } from '../src/common/validation/response.interceptor';

/**
 * PROVES: a response leaves the API only through the schema its route declared, over
 * real HTTP.
 *
 * The route-coverage test proves every route DECLARES a response. This asks what the
 * declaration does on a request: the real interceptor, the real filters, Express and a
 * socket. The failure it exists for is a handler returning more than it meant to -- a
 * database row where a response was intended -- and the wire carrying all of it.
 *
 * No database: the controller below is a fixture.
 */
const Thing = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int().nonnegative(),
});

const SECRET = 'scrypt$hash-that-must-never-leave';
const handled = vi.fn();

@Controller('things')
class ThingsController {
  /** The mistake this layer exists for: the handler returns the whole row. */
  @Get('row')
  @Responds(Thing)
  row() {
    return { id: 't1', name: 'U14', version: 3, passwordHash: SECRET, internalNote: 'x' };
  }

  @Get('versioned')
  @Responds(Thing, { etag: true })
  versioned() {
    return { id: 't1', name: 'U14', version: 3 };
  }

  @Get('missing-field')
  @Responds(Thing)
  missingField() {
    handled();
    return { id: 't1', version: 3, passwordHash: SECRET };
  }

  @Get('wrong-type')
  @Responds(Thing)
  wrongType() {
    return { id: 't1', name: 'U14', version: 'three' };
  }

  /** Declares an ETag and returns a body with no version to make one from. */
  @Get('etag-without-version')
  @Responds(z.object({ id: z.string() }), { etag: true })
  etagWithoutVersion() {
    return { id: 't1' };
  }

  @Get('forgot')
  forgot() {
    handled();
    return { anything: 1 };
  }

  @Post('created')
  @Responds(Thing)
  created() {
    return { id: 't2', name: 'U16', version: 0 };
  }

  @Post('moved')
  @Responds(Thing, { status: 200 })
  moved() {
    return { id: 't2', name: 'U16', version: 0 };
  }

  @Post('nothing')
  @Responds(null)
  nothing(): void {}

  @Post('nothing-but-something')
  @Responds(null)
  nothingButSomething() {
    return { leaked: SECRET };
  }

  @Patch('edit')
  @Responds(Thing, { etag: true })
  edit(@IfMatch() expected: number) {
    return { id: 't1', name: 'U14', version: expected + 1 };
  }

  @Get('list')
  @Responds(z.array(Thing))
  list() {
    return [
      { id: 't1', name: 'U14', version: 1, passwordHash: SECRET },
      { id: 't2', name: 'U16', version: 2, passwordHash: SECRET },
    ];
  }
}

/** Keeps the responder's output off the console and available to assert on. */
function captureLogs() {
  const lines: string[] = [];
  const record = (...parts: unknown[]) => void lines.push(parts.map(String).join('\n'));
  const spies = (['error', 'warn', 'log', 'debug'] as const).map((level) =>
    vi.spyOn(Logger.prototype, level).mockImplementation(record),
  );
  return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

/**
 * The providers `AppModule` registers, built by factory: Vitest compiles with esbuild,
 * which emits no decorator metadata, so Nest cannot resolve constructor parameters by
 * type here. That the compiled application wires them is the smoke script's claim.
 */
@Module({
  controllers: [ThingsController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new ResponseInterceptor(reflector),
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

describe('response encoding over HTTP', () => {
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

  it('strips a field the schema does not declare', async () => {
    const response = await http().get('/things/row').expect(200);

    expect(response.body).toEqual({ id: 't1', name: 'U14', version: 3 });
    expect(response.text).not.toContain(SECRET);
  });

  it('strips it from every element of a list', async () => {
    const response = await http().get('/things/list').expect(200);

    expect(response.body).toEqual([
      { id: 't1', name: 'U14', version: 1 },
      { id: 't2', name: 'U16', version: 2 },
    ]);
    expect(response.text).not.toContain(SECRET);
  });

  it('turns a missing required field into response_contract_violation, not a partial body', async () => {
    const response = await http().get('/things/missing-field').expect(500);

    expect(response.body).toMatchObject({
      statusCode: 500,
      type: 'INTERNAL',
      code: 'response_contract_violation',
      message: 'Internal server error',
    });
    // Nothing of what the handler returned reaches the client...
    expect(response.text).not.toContain(SECRET);
    expect(response.text).not.toContain('t1');
    // ...and whoever reads the log is told which route and which field, not the value.
    const log = logs.lines.join('\n');
    expect(log).toContain('ThingsController.missingField returned a value its response schema refuses');
    expect(log).toContain('name');
    expect(log).not.toContain(SECRET);
  });

  it('refuses a field of the wrong type the same way', async () => {
    const response = await http().get('/things/wrong-type').expect(500);
    expect((response.body as { code: string }).code).toBe('response_contract_violation');
  });

  /**
   * The fail-closed half. Delete the `@Responds` from a real route and this is what
   * its callers get: not whatever the handler returns, a refusal -- before it runs.
   */
  it('refuses a route that declares no response, without running its handler', async () => {
    const response = await http().get('/things/forgot').expect(500);

    expect(response.body).toMatchObject({ type: 'INTERNAL', code: 'response_not_declared' });
    expect(handled).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('forgot');
    expect(logs.lines.join('\n')).toContain('ThingsController.forgot declares no response schema');
  });

  describe('status', () => {
    it('keeps Nest\'s default when none is declared: 201 for a POST', async () => {
      await http().post('/things/created').expect(201);
    });

    it('applies a declared status to the route, so the document and the wire agree', async () => {
      await http().post('/things/moved').expect(200);
    });

    it('@Responds(null) answers 204 with no body', async () => {
      const response = await http().post('/things/nothing').expect(204);
      expect(response.text).toBe('');
    });

    it('@Responds(null) refuses a handler that returns something anyway', async () => {
      const response = await http().post('/things/nothing-but-something').expect(500);
      expect((response.body as { code: string }).code).toBe('response_contract_violation');
      expect(response.text).not.toContain(SECRET);
    });
  });

  describe('ETag', () => {
    it('is the version of the ENCODED body, quoted', async () => {
      const response = await http().get('/things/versioned').expect(200);
      expect(response.headers.etag).toBe('"3"');
      expect((response.body as { version: number }).version).toBe(3);
    });

    it('is not sent by a route that does not declare one', async () => {
      const response = await http().get('/things/row').expect(200);
      // Express adds a weak content ETag of its own to a GET; ours is the strong version.
      expect(response.headers.etag).not.toBe('"3"');
    });

    it('declared on a body with no version is a contract violation', async () => {
      const response = await http().get('/things/etag-without-version').expect(500);
      expect((response.body as { code: string }).code).toBe('response_contract_violation');
    });
  });

  describe('@IfMatch', () => {
    it('hands the handler the parsed version and returns the next one as ETag', async () => {
      const response = await http().patch('/things/edit').set('If-Match', '"7"').expect(200);
      expect(response.body).toMatchObject({ version: 8 });
      expect(response.headers.etag).toBe('"8"');
    });

    it('refuses a write that does not say which version it edits', async () => {
      const response = await http().patch('/things/edit').expect(400);
      expect(response.body).toMatchObject({ type: 'BAD_REQUEST', code: 'if_match_required' });
    });

    it('refuses a malformed version', async () => {
      const response = await http().patch('/things/edit').set('If-Match', '"latest"').expect(400);
      expect((response.body as { code: string }).code).toBe('if_match_malformed');
    });
  });
});
