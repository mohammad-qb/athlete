import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { AUTHZ_METADATA, PUBLIC_METADATA } from '../src/common/authz/authorize.decorator';

type Ctor = new (...args: never[]) => unknown;

/**
 * PROVES: no route can reach production without an authorization decision.
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

/** Returns the prototype member only when it is a decorated route handler. */
function handlerOf(controller: Ctor, name: string): object | undefined {
  const prototype = controller.prototype as Record<string, unknown>;
  const member = prototype[name];
  if (typeof member !== 'function') return undefined;
  return Reflect.getMetadata(METHOD_METADATA, member) === undefined ? undefined : member;
}

function routeHandlers(controller: Ctor): string[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype).filter(
    (name) => name !== 'constructor' && handlerOf(controller, name) !== undefined,
  );
}

describe('authorization route coverage', () => {
  const controllers = collectControllers(AppModule as unknown as Ctor);

  it('discovers the controllers in the module graph', () => {
    expect(controllers.length).toBeGreaterThan(0);
  });

  it('every route declares either @Authorize or @Public', () => {
    const undeclared: string[] = [];

    for (const controller of controllers) {
      const basePath = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
      for (const handlerName of routeHandlers(controller)) {
        const handler = handlerOf(controller, handlerName);
        if (!handler) continue;
        const hasAuthorize = Reflect.getMetadata(AUTHZ_METADATA, handler) !== undefined;
        const isPublic = Reflect.getMetadata(PUBLIC_METADATA, handler) !== undefined;
        if (!hasAuthorize && !isPublic) {
          undeclared.push(`${String(basePath)}/${controller.name}.${handlerName}`);
        }
      }
    }

    expect(
      undeclared,
      `Routes with no authorization decision:\n  ${undeclared.join('\n  ')}\n` +
        'Add @Authorize({ roles: [...] }) or @Public().',
    ).toEqual([]);
  });

  it('keeps the set of @Public routes small and intentional', () => {
    // A growing public surface is the quiet way an authorization model erodes, so the
    // allowlist is asserted explicitly: adding to it requires editing this test.
    const publicRoutes: string[] = [];
    for (const controller of controllers) {
      for (const handlerName of routeHandlers(controller)) {
        const handler = handlerOf(controller, handlerName);
        if (handler && Reflect.getMetadata(PUBLIC_METADATA, handler) !== undefined) {
          publicRoutes.push(`${controller.name}.${handlerName}`);
        }
      }
    }
    expect(publicRoutes.sort()).toEqual(['HealthController.live']);
  });
});
