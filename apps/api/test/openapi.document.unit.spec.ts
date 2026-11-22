import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, Get, Module, Post } from '@nestjs/common';
import { AthleteResponse, CreateAthleteRequest, strictObject } from '@athlete/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_GLOBAL_PREFIX, AppModule } from '../src/app.module';
import { Public } from '../src/common/authz/permission.decorator';
import { Responds } from '../src/common/validation/responds.decorator';
import { Validate } from '../src/common/validation/validate.decorator';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/auth.factory';
import {
  buildOpenApiDocument,
  serializeOpenApiDocument,
  type OpenApiDocument,
} from '../src/openapi/document';
import { collectRoutes, successStatus, type Ctor } from '../src/openapi/routes';

/**
 * PROVES: `apps/api/openapi.json` is what the code generates, is a valid OpenAPI 3.1
 * document, and describes every route the API serves.
 *
 * The document is committed because the web client is generated from it and a reviewer
 * should see a contract change as a diff. Committed means it can go stale, so this test
 * regenerates it and compares: a route added, a field renamed or a status changed
 * without regenerating is a red build. The generated client has the same check in CI.
 *
 * It needs no database and constructs no controller: the generator reads metadata.
 */
const OPENAPI_PATH = resolve(__dirname, '../openapi.json');
const OPTIONS = {
  title: 'Athlete Platform API',
  version: '1.0.0',
  sessionCookie: SESSION_COOKIE_NAME,
};

const generate = (root: Ctor): OpenApiDocument =>
  buildOpenApiDocument(collectRoutes(root, API_GLOBAL_PREFIX), OPTIONS);

type Operation = {
  operationId: string;
  security?: unknown[];
  parameters?: { name: string; in: string; required: boolean; schema: Record<string, unknown> }[];
  requestBody?: { content: Record<string, { schema: Record<string, unknown> }> };
  responses: Record<
    string,
    { $ref?: string; headers?: Record<string, unknown>; content?: Record<string, { schema: Record<string, unknown> }> }
  >;
};

describe('the OpenAPI document', () => {
  const routes = collectRoutes(AppModule, API_GLOBAL_PREFIX);
  const document = generate(AppModule);
  const operationFor = (method: string, path: string) =>
    document.paths[path]?.[method] as Operation | undefined;

  it('apps/api/openapi.json matches what the code generates', () => {
    const expected = serializeOpenApiDocument(document);

    if (process.env.UPDATE_OPENAPI === '1') writeFileSync(OPENAPI_PATH, expected);

    const committed = existsSync(OPENAPI_PATH) ? readFileSync(OPENAPI_PATH, 'utf8') : '';
    expect(
      committed === expected,
      'openapi.json is out of date. Run: UPDATE_OPENAPI=1 pnpm --filter @athlete/api run test, ' +
        'then pnpm --filter @athlete/web run generate',
    ).toBe(true);
  });

  describe('is a valid OpenAPI 3.1 document', () => {
    let result: { valid: boolean; errors?: unknown };
    let version: string | undefined;

    beforeAll(async () => {
      // ESM-only, and this package compiles to CommonJS: a dynamic import is the form
      // that works in both, as with better-auth.
      const { Validator } = await import('@seriousme/openapi-schema-validator');
      const validator = new Validator();
      result = await validator.validate(structuredClone(document) as unknown as Record<string, unknown>);
      version = validator.version;
    });

    it('validates against the OpenAPI 3.1 schema', () => {
      expect(result.errors ?? []).toEqual([]);
      expect(result.valid).toBe(true);
      expect(version).toBe('3.1');
    });
  });

  it('contains every route in the manifest, and nothing else', () => {
    const documented = Object.entries(document.paths)
      .flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .sort();
    const served = routes
      .map((route) => `${route.method} ${route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`)
      .sort();

    expect(documented).toEqual(served);
    expect(documented.length).toBeGreaterThan(0);
  });

  it('gives every operation a unique id of the form <controller>_<handler>', () => {
    const ids = Object.values(document.paths).flatMap((operations) =>
      Object.values(operations).map((operation) => (operation as Operation).operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('athletes_list');
    expect(ids).toContain('me_switchAcademy');
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z]*_[a-z][A-Za-z]*$/);
  });

  it('documents the success status each route actually answers with', () => {
    for (const route of routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const operation = operationFor(route.method.toLowerCase(), path);
      expect(Object.keys(operation?.responses ?? {}), route.name).toContain(
        String(successStatus(route)),
      );
    }
  });

  it('every $ref resolves to a schema or response in the document', () => {
    const refs: string[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (typeof node !== 'object' || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.push(value);
        else visit(value);
      }
    };
    visit(document);

    const resolves = (ref: string) => {
      const [, , kind, name] = ref.split('/');
      const section = (document.components as Record<string, Record<string, unknown>>)[kind ?? ''];
      return ref.startsWith('#/components/') && section?.[name ?? ''] !== undefined;
    };
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => !resolves(ref))).toEqual([]);
  });

  it('names the contracts as components instead of repeating them', () => {
    expect(Object.keys(document.components.schemas)).toEqual(
      expect.arrayContaining([
        'AthletePage',
        'AthleteResponse',
        'CreateAthleteRequest',
        'ErrorResponse',
        'MeResponse',
        'SessionPage',
        'TeamPage',
        'UpdateAthleteRequest',
      ]),
    );
    expect(operationFor('get', '/api/v1/athletes')?.responses['200']?.content).toEqual({
      'application/json': { schema: { $ref: '#/components/schemas/AthletePage' } },
    });
  });

  it('lists a list route\'s query parameters with their defaults, none of them required', () => {
    const parameters = operationFor('get', '/api/v1/athletes')?.parameters ?? [];
    expect(parameters.map((parameter) => `${parameter.in}:${parameter.name}`)).toEqual([
      'query:page',
      'query:pageSize',
      'query:sort',
      'query:q',
    ]);
    expect(parameters.every((parameter) => !parameter.required)).toBe(true);
    expect(parameters.find((parameter) => parameter.name === 'pageSize')?.schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 25,
    });
    expect(parameters.find((parameter) => parameter.name === 'sort')?.schema).toMatchObject({
      default: 'lastName',
      enum: expect.arrayContaining(['lastName', '-lastName', 'createdAt', '-createdAt']),
    });
  });

  it('puts If-Match and ETag on the routes that use them, and only those', () => {
    const update = operationFor('patch', '/api/v1/athletes/{id}');
    expect(update?.parameters).toContainEqual(
      expect.objectContaining({ name: 'If-Match', in: 'header', required: true }),
    );
    expect(update?.responses['200']?.headers).toHaveProperty('ETag');
    expect(operationFor('get', '/api/v1/athletes/{id}')?.responses['200']?.headers).toHaveProperty(
      'ETag',
    );

    const list = operationFor('get', '/api/v1/athletes');
    expect(list?.parameters?.some((parameter) => parameter.in === 'header')).toBe(false);
    expect(list?.responses['200']?.headers).toBeUndefined();
  });

  it('answers every error status with the one shared error body', () => {
    const update = operationFor('patch', '/api/v1/athletes/{id}');
    for (const status of ['400', '401', '403', '404', '409']) {
      expect(update?.responses[status]?.$ref, status).toBe('#/components/responses/Error');
    }
    expect(document.components.responses).toMatchObject({
      Error: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    });
    // A read cannot conflict, and a list names no row to be missing.
    const list = operationFor('get', '/api/v1/athletes');
    expect(Object.keys(list?.responses ?? {}).sort()).toEqual(['200', '400', '401', '403']);
  });

  it('requires the session cookie everywhere except on a @Public route', () => {
    expect(document.security).toEqual([{ sessionCookie: [] }]);
    expect(document.components.securitySchemes).toMatchObject({
      sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE_NAME },
    });

    const health = operationFor('get', '/api/v1/health');
    expect(health?.security).toEqual([]);
    expect(Object.keys(health?.responses ?? {})).toEqual(['200']);
    expect(operationFor('get', '/api/v1/me')?.security).toBeUndefined();
  });

  it('leaves better-auth\'s own routes out', () => {
    expect(Object.keys(document.paths).filter((path) => path.startsWith('/api/auth'))).toEqual([]);
  });
});

describe('rendering contracts as JSON Schema', () => {
  it('renders a request from its input side and a response from its output side', () => {
    const Request = strictObject({ name: z.string(), note: z.string().nullable().default(null) }).meta({
      id: 'OpenApiFixtureRequest',
    });
    const Response = z.object({ name: z.string(), note: z.string().nullable() }).meta({
      id: 'OpenApiFixtureResponse',
    });

    @Controller('fixture')
    class FixtureController {
      @Post()
      @Public()
      @Validate({ body: Request })
      @Responds(Response)
      create(): void {}
    }
    @Module({ controllers: [FixtureController] })
    class FixtureModule {}

    const { schemas } = generate(FixtureModule).components;

    // A field with a default is optional to SEND, and the request refuses unknown keys.
    expect(schemas.OpenApiFixtureRequest).toMatchObject({
      required: ['name'],
      additionalProperties: false,
    });
    // ...and always present in what comes BACK. A response object stays open: adding a
    // field must not break a client that validates what it receives.
    expect(schemas.OpenApiFixtureResponse).toMatchObject({ required: ['name', 'note'] });
    expect(schemas.OpenApiFixtureResponse).not.toHaveProperty('additionalProperties');
  });

  it('refuses one schema used as both request and response when its two sides differ', () => {
    @Controller('fixture')
    class FixtureController {
      @Post()
      @Public()
      // `CreateAthleteRequest` has no default, so its sides agree...
      @Validate({ body: CreateAthleteRequest })
      @Responds(CreateAthleteRequest)
      same(): void {}
    }
    @Module({ controllers: [FixtureController] })
    class Agreeing {}
    expect(() => generate(Agreeing)).not.toThrow();

    const Both = strictObject({ note: z.string().default('') }).meta({ id: 'OpenApiFixtureBoth' });
    @Controller('fixture')
    class DifferingController {
      @Post()
      @Public()
      @Validate({ body: Both })
      @Responds(Both)
      differs(): void {}
    }
    @Module({ controllers: [DifferingController] })
    class Differing {}
    // ...and one with a default does not: optional going in, required coming out.
    expect(() => generate(Differing)).toThrow(/renders to two different shapes/);
  });

  it('refuses to document a route that declares no response', () => {
    @Controller('fixture')
    class FixtureController {
      @Get()
      @Public()
      forgot(): void {}
    }
    @Module({ controllers: [FixtureController] })
    class FixtureModule {}

    expect(() => generate(FixtureModule)).toThrow(/declares no response/);
  });

  it('keeps the version on a versioned response, which is what ETag is made from', () => {
    const { schemas } = generate(AppModule).components;
    expect((schemas.AthleteResponse as { required: string[] }).required).toContain('version');
    expect(z.globalRegistry.get(AthleteResponse)?.id).toBe('AthleteResponse');
  });
});
