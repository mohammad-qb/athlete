import 'reflect-metadata';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Body, Controller, Get, Module, Param, Post, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { Action, Subject } from '@athlete/contracts';
import { describe, expect, it } from 'vitest';
import { API_GLOBAL_PREFIX, AppModule } from '../src/app.module';
import {
  Permission,
  PERMISSION_METADATA,
  Public,
  PUBLIC_METADATA,
  type PermissionSpec,
} from '../src/common/authz/permission.decorator';
import {
  readValidated,
  Validate,
  VALIDATE_METADATA,
  VALIDATION_SLOTS,
  ValidBody,
  type ValidationSlot,
  type ValidationSpec,
  type ValidSlotRequest,
} from '../src/common/validation/validate.decorator';

type Ctor = new (...args: never[]) => unknown;

/**
 * PROVES: no route can reach production without an authorization decision, and the
 * decisions that exist are written in the policy's real vocabulary.
 *
 * Deny-by-default already fails such a request at runtime. This test makes it fail in
 * CI instead -- so "we forgot the guard on the new endpoint" is a red build rather than
 * an incident. It walks the real module graph, so adding a controller anywhere is
 * covered automatically; there is no list here to forget to update.
 *
 * It needs no database: it reads decorator metadata only.
 */
function collectControllers(module: Ctor, seen = new Set<Ctor>()): Ctor[] {
  if (seen.has(module)) return [];
  seen.add(module);

  const controllers: Ctor[] = [...((Reflect.getMetadata('controllers', module) as Ctor[]) ?? [])];
  const imports = (Reflect.getMetadata('imports', module) as Ctor[]) ?? [];

  for (const imported of imports) {
    if (typeof imported === 'function') {
      controllers.push(...collectControllers(imported, seen));
    }
  }
  return controllers;
}

interface Route {
  /** `Controller.handler` -- the stable name used in messages and the allowlist. */
  name: string;
  method: string;
  path: string;
  permission: PermissionSpec | undefined;
  isPublic: boolean;
  /** The `@Validate` schemas, as the interceptor resolves them. */
  validation: ValidationSpec;
  /** Slots the handler reads through `@ValidBody/@ValidParams/@ValidQuery`. */
  reads: ValidationSlot[];
  /** Nest's own `@Body/@Param/@Query` on the handler: input that bypasses validation. */
  rawInputs: string[];
}

const RAW_INPUT_DECORATORS: Partial<Record<RouteParamtypes, string>> = {
  [RouteParamtypes.BODY]: '@Body',
  [RouteParamtypes.QUERY]: '@Query',
  [RouteParamtypes.PARAM]: '@Param',
};

/**
 * How a handler's parameters are bound, from the metadata Nest itself routes by.
 * Built-in decorators are keyed `<paramtype>:<index>`; a custom one is stored with its
 * factory, which for the `@Valid*` family is `readValidated`.
 */
function inspectArguments(controller: Ctor, handlerName: string) {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {}) as Record<
    string,
    { factory?: unknown; data?: unknown }
  >;
  const reads: ValidationSlot[] = [];
  const rawInputs: string[] = [];

  for (const [key, arg] of Object.entries(args)) {
    if (arg.factory === readValidated) {
      reads.push((arg.data as ValidSlotRequest).slot);
      continue;
    }
    const raw = RAW_INPUT_DECORATORS[Number(key.split(':')[0]) as RouteParamtypes];
    if (raw && arg.factory === undefined) rawInputs.push(raw);
  }
  return { reads, rawInputs };
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0)
    .join('/');
  return `/${joined}`;
}

/**
 * Every decorated route handler reachable from the module graph.
 *
 * Authorization metadata is resolved with the guard's own call -- handler first, then
 * controller -- so a class-level `@Public()` or `@Permission()` is seen here exactly as
 * the guard will see it. Reading the handler alone would let a controller-level
 * `@Public()` open a route this test still reported as protected.
 */
function collectRoutes(root: Ctor): Route[] {
  const routes: Route[] = [];
  const reflector = new Reflector();

  for (const controller of collectControllers(root)) {
    const basePath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const prototype = controller.prototype as Record<string, unknown>;

    for (const handlerName of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[handlerName];
      if (handlerName === 'constructor' || typeof handler !== 'function') continue;

      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;

      routes.push({
        name: `${controller.name}.${handlerName}`,
        method: RequestMethod[method],
        path: joinPath(
          API_GLOBAL_PREFIX,
          basePath,
          String(Reflect.getMetadata(PATH_METADATA, handler) ?? ''),
        ),
        permission: reflector.getAllAndOverride<PermissionSpec | undefined>(PERMISSION_METADATA, [
          handler,
          controller,
        ]),
        isPublic: Boolean(
          reflector.getAllAndOverride<boolean | undefined>(PUBLIC_METADATA, [handler, controller]),
        ),
        validation:
          reflector.getAllAndOverride<ValidationSpec | undefined>(VALIDATE_METADATA, [
            handler,
            controller,
          ]) ?? {},
        ...inspectArguments(controller, handlerName),
      });
    }
  }

  return routes;
}

/**
 * Subjects the policy names but no route operates on yet. Listed, rather than
 * tolerated, so the vocabulary cannot grow ahead of the API unnoticed: a new subject
 * must either be claimed by a route or be added here by someone who meant it.
 *
 *  - assessments       modelled and granted, API not in this slice
 *  - userAcademyRoles  read-only by policy; role grants are not an API operation
 */
const RESERVED_SUBJECTS: Subject[] = ['assessments', 'userAcademyRoles'];

const MANIFEST_PATH = resolve(__dirname, '../../../docs/reference/route-manifest.md');

function renderManifest(routes: Route[]): string {
  const rows = [...routes]
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
    .map((route) => {
      const action = route.permission?.action ?? (route.isPublic ? '_public_' : '**undeclared**');
      const subject = route.permission?.subject ?? (route.isPublic ? '_public_' : '**undeclared**');
      const validates = VALIDATION_SLOTS.filter((slot) => route.validation[slot]).join(', ') || '—';
      return `| ${route.method} | \`${route.path}\` | \`${route.name}\` | ${action} | ${subject} | ${validates} |`;
    });

  return [
    '# Route manifest',
    '',
    '<!-- GENERATED by apps/api/test/authz.route-coverage.spec.ts. Do not edit by hand. -->',
    '',
    'Every HTTP route in `apps/api`, as a client calls it (global prefix',
    `\`/${API_GLOBAL_PREFIX}\` included), with the operation it declares to the authorization`,
    'guard. Generated from the same decorator metadata the guard reads, by walking the real',
    'module graph; the test fails when this file and the code disagree, so a change to the',
    'API surface or to what a route demands is always a reviewed diff here.',
    '',
    'Who holds each `(action, subject)` pair is decided in one place:',
    '[`apps/api/src/common/authz/ability.ts`](../../apps/api/src/common/authz/ability.ts).',
    '',
    '"Validates" lists the parts of the request the route declares a schema for with',
    '`@Validate`. A handler can only read a part that is listed: the `@Valid*` parameter',
    'decorators refuse an undeclared one at runtime, and the same test fails the build first.',
    '',
    'Regenerate with:',
    '',
    '```bash',
    'UPDATE_ROUTE_MANIFEST=1 pnpm --filter @athlete/api run test',
    '```',
    '',
    '| Method | Path | Handler | Action | Subject | Validates |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

describe('authorization route coverage', () => {
  const routes = collectRoutes(AppModule);

  it('discovers the routes in the module graph', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('every route declares either @Permission or @Public', () => {
    const undeclared = routes
      .filter((route) => route.permission === undefined && !route.isPublic)
      .map((route) => `${route.method} ${route.path} (${route.name})`);

    expect(
      undeclared,
      `Routes with no authorization decision:\n  ${undeclared.join('\n  ')}\n` +
        'Add @Permission({ action, subject }) or @Public().',
    ).toEqual([]);
  });

  it('no route declares both: a public route with a permission is a contradiction', () => {
    const both = routes.filter((route) => route.permission && route.isPublic).map((r) => r.name);
    expect(both).toEqual([]);
  });

  it('reads controller-level metadata as the guard does', () => {
    @Public()
    @Controller('open')
    class OpenController {
      @Get()
      @Permission({ action: 'read', subject: 'athletes' })
      contradictory(): void {}
    }
    @Permission({ action: 'read', subject: 'teams' })
    @Controller('gated')
    class GatedController {
      @Get()
      inherited(): void {}
      @Get('own')
      @Permission({ action: 'read', subject: 'athletes' })
      overridden(): void {}
    }
    @Module({ controllers: [OpenController, GatedController] })
    class FixtureModule {}

    const found = Object.fromEntries(collectRoutes(FixtureModule).map((route) => [route.name, route]));

    // The guard would let this through as public, so it must surface as the contradiction.
    expect(found['OpenController.contradictory']).toMatchObject({
      isPublic: true,
      permission: { action: 'read', subject: 'athletes' },
    });
    expect(found['GatedController.inherited']).toMatchObject({
      isPublic: false,
      permission: { action: 'read', subject: 'teams' },
    });
    expect(found['GatedController.overridden']?.permission?.subject).toBe('athletes');
  });

  it('every declared (action, subject) exists in the contracts enums', () => {
    // The decorator is typed, so this cannot fail from honest code. It is here for the
    // dishonest kind: an `as never` cast, or metadata set without the decorator.
    const invalid = routes
      .filter((route) => route.permission !== undefined)
      .filter(
        (route) =>
          !Action.safeParse(route.permission?.action).success ||
          !Subject.safeParse(route.permission?.subject).success,
      )
      .map((route) => `${route.name}: ${JSON.stringify(route.permission)}`);
    expect(invalid).toEqual([]);
  });

  it('every subject is claimed by a route or explicitly reserved', () => {
    const claimed = new Set(routes.map((route) => route.permission?.subject));
    const unaccounted = Subject.options.filter(
      (subject) => !claimed.has(subject) && !RESERVED_SUBJECTS.includes(subject),
    );
    expect(
      unaccounted,
      `Subjects no route uses: ${unaccounted.join(', ')}. Claim them or add to RESERVED_SUBJECTS.`,
    ).toEqual([]);
  });

  it('a reserved subject is removed from the reserve once a route claims it', () => {
    const claimed = new Set(routes.map((route) => route.permission?.subject));
    expect(RESERVED_SUBJECTS.filter((subject) => claimed.has(subject))).toEqual([]);
  });

  it('keeps the set of @Public routes small and intentional', () => {
    // A growing public surface is the quiet way an authorization model erodes, so the
    // allowlist is asserted explicitly: adding to it requires editing this test.
    const publicRoutes = routes.filter((route) => route.isPublic).map((route) => route.name);
    expect(publicRoutes.sort()).toEqual(['HealthController.live']);
  });

  it('docs/reference/route-manifest.md matches the routes in the code', () => {
    const expected = renderManifest(routes);

    if (process.env.UPDATE_ROUTE_MANIFEST === '1') {
      mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
      writeFileSync(MANIFEST_PATH, expected);
    }

    const committed = existsSync(MANIFEST_PATH) ? readFileSync(MANIFEST_PATH, 'utf8') : '';
    expect(
      committed,
      'Route manifest is out of date. Run: UPDATE_ROUTE_MANIFEST=1 pnpm --filter @athlete/api run test',
    ).toBe(expected);
  });
});

/**
 * PROVES: every route that takes input declares a schema for it, and no handler has a
 * way to read input that skipped one.
 *
 * This is the static half. It shows a declaration exists; `validation.http.spec.ts`
 * shows the declaration is enforced on a real request.
 */
describe('validation route coverage', () => {
  const routes = collectRoutes(AppModule);
  const label = (route: Route) => `${route.method} ${route.path} (${route.name})`;

  it('no handler reads input through @Body, @Param or @Query', () => {
    // Those hand over the raw request. The only sanctioned readers are the @Valid*
    // decorators, which read what the interceptor parsed.
    const raw = routes
      .filter((route) => route.rawInputs.length > 0)
      .map((route) => `${label(route)}: ${route.rawInputs.join(', ')}`);
    expect(raw).toEqual([]);
  });

  it('every part of the request a handler reads has a declared schema', () => {
    const undeclared = routes.flatMap((route) =>
      route.reads
        .filter((slot) => !route.validation[slot])
        .map((slot) => `${label(route)} reads ${slot} without @Validate({ ${slot} })`),
    );
    expect(undeclared).toEqual([]);
  });

  it('every route that takes a body declares a body schema', () => {
    const missing = routes
      .filter((route) => ['POST', 'PUT', 'PATCH'].includes(route.method))
      .filter((route) => !route.validation.body)
      .map(label);
    expect(missing).toEqual([]);
  });

  it('every route with a path parameter declares a params schema', () => {
    const missing = routes
      .filter((route) => route.path.includes(':'))
      .filter((route) => !route.validation.params)
      .map(label);
    expect(missing).toEqual([]);
  });

  it('every declared schema refuses an unknown key', () => {
    // A stripping schema is how a misspelled field became a successful no-op.
    const lenient = routes.flatMap((route) =>
      VALIDATION_SLOTS.filter((slot) => {
        const result = route.validation[slot]?.safeParse({ __not_a_field__: 1 });
        return (
          result !== undefined &&
          !result.error?.issues.some((issue) => issue.code === 'unrecognized_keys')
        );
      }).map((slot) => `${label(route)}: ${slot} schema is not strict`),
    );
    expect(lenient).toEqual([]);
  });

  it('sees raw decorators and undeclared reads, so the checks above can fail', () => {
    @Controller('fixture')
    class FixtureController {
      @Post('raw/:id')
      raw(@Body() _body: unknown, @Param('id') _id: string): void {}
      @Post('undeclared')
      undeclared(@ValidBody() _body: unknown): void {}
      @Post('declared')
      @Validate({ body: Action })
      declared(@ValidBody() _body: unknown): void {}
    }
    @Module({ controllers: [FixtureController] })
    class FixtureModule {}

    const found = Object.fromEntries(collectRoutes(FixtureModule).map((route) => [route.name, route]));

    expect(found['FixtureController.raw']?.rawInputs.sort()).toEqual(['@Body', '@Param']);
    expect(found['FixtureController.undeclared']).toMatchObject({ reads: ['body'], validation: {} });
    expect(found['FixtureController.declared']?.validation.body).toBe(Action);
  });
});
