import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import {
  AUTHENTICATED_METADATA,
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  type PermissionSpec,
} from '../common/authz/permission.decorator';
import { readIfMatch } from '../common/http/if-match.decorator';
import { RESPONDS_METADATA, type RespondsSpec } from '../common/validation/responds.decorator';
import {
  readValidated,
  VALIDATE_METADATA,
  type ValidationSlot,
  type ValidationSpec,
  type ValidSlotRequest,
} from '../common/validation/validate.decorator';

/**
 * The API's routes, read from decorator metadata by walking the module graph.
 *
 * ONE walk, with two readers: the route-coverage test, which fails the build on a route
 * that declares no authorization, no input schema or no response, and the OpenAPI
 * generator, which publishes what the same routes declared. They cannot disagree about
 * which routes exist or what a route demands, because neither has a list of its own.
 *
 * Nothing here runs a handler or constructs a provider: it reads the metadata Nest
 * itself routes by. That is why it works under Vitest, where controllers cannot be
 * instantiated (esbuild emits no constructor-parameter metadata).
 */

export type Ctor = new (...args: never[]) => unknown;

export interface Route {
  /** `Controller.handler` -- the stable name used in messages and allowlists. */
  name: string;
  /** The controller class name, e.g. `AthletesController`. */
  controller: string;
  /** The handler method name, e.g. `getById`. */
  handler: string;
  method: string;
  /** As a client calls it, global prefix included, in Nest's `:param` form. */
  path: string;
  permission: PermissionSpec | undefined;
  isPublic: boolean;
  /** `@Authenticated`: any signed-in identity, no `(action, subject)`. */
  isAuthenticated: boolean;
  /** The `@Validate` schemas, as the interceptor resolves them. */
  validation: ValidationSpec;
  /** The `@Responds` declaration, as the response interceptor resolves it. */
  responds: RespondsSpec | undefined;
  /** The handler takes `@IfMatch()`: the request must carry the version it edits. */
  ifMatch: boolean;
  /** Slots the handler reads through `@ValidBody/@ValidParams/@ValidQuery`. */
  reads: ValidationSlot[];
  /** Nest's own `@Body/@Param/@Query` on the handler: input that bypasses validation. */
  rawInputs: string[];
}

export function collectControllers(module: Ctor, seen = new Set<Ctor>()): Ctor[] {
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

const RAW_INPUT_DECORATORS: Partial<Record<RouteParamtypes, string>> = {
  [RouteParamtypes.BODY]: '@Body',
  [RouteParamtypes.QUERY]: '@Query',
  [RouteParamtypes.PARAM]: '@Param',
};

/**
 * How a handler's parameters are bound, from the metadata Nest itself routes by.
 * Built-in decorators are keyed `<paramtype>:<index>`; a custom one is stored with its
 * factory, which for the `@Valid*` family is `readValidated` and for `@IfMatch` is
 * `readIfMatch`.
 */
function inspectArguments(controller: Ctor, handlerName: string) {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ?? {}) as Record<
    string,
    { factory?: unknown; data?: unknown }
  >;
  const reads: ValidationSlot[] = [];
  const rawInputs: string[] = [];
  let ifMatch = false;

  for (const [key, arg] of Object.entries(args)) {
    if (arg.factory === readValidated) {
      reads.push((arg.data as ValidSlotRequest).slot);
      continue;
    }
    if (arg.factory === readIfMatch) {
      ifMatch = true;
      continue;
    }
    const raw = RAW_INPUT_DECORATORS[Number(key.split(':')[0]) as RouteParamtypes];
    if (raw && arg.factory === undefined) rawInputs.push(raw);
  }
  return { reads, rawInputs, ifMatch };
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
 * `@Public()` open a route this walk still reported as protected. `@Responds` is read
 * from the handler only, as the response interceptor reads it.
 */
export function collectRoutes(root: Ctor, globalPrefix = ''): Route[] {
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
        controller: controller.name,
        handler: handlerName,
        method: RequestMethod[method],
        path: joinPath(
          globalPrefix,
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
        isAuthenticated: Boolean(
          reflector.getAllAndOverride<boolean | undefined>(AUTHENTICATED_METADATA, [
            handler,
            controller,
          ]),
        ),
        validation:
          reflector.getAllAndOverride<ValidationSpec | undefined>(VALIDATE_METADATA, [
            handler,
            controller,
          ]) ?? {},
        responds: reflector.get<RespondsSpec | undefined>(RESPONDS_METADATA, handler),
        ...inspectArguments(controller, handlerName),
      });
    }
  }

  return routes;
}

/**
 * The success status a route answers with: the one it declared, or Nest's default for
 * the method. Stated once so the manifest and the OpenAPI document print the same one.
 */
export function successStatus(route: Pick<Route, 'method' | 'responds'>): number {
  return route.responds?.status ?? (route.method === 'POST' ? 201 : 200);
}
