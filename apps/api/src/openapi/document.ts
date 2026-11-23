import { ErrorResponse } from '@athlete/contracts';
import { z, type ZodType } from 'zod';
import { successStatus, type Route } from './routes';

/**
 * Builds the OpenAPI 3.1 document from the routes' own declarations.
 *
 * Nothing in the document is written by hand. Paths, methods and operation ids come
 * from the route walk; request shapes from `@Validate`; response shapes from
 * `@Responds`; and every schema is the Zod contract itself, rendered by Zod
 * (`z.toJSONSchema`). So the document cannot describe an API other than the one that
 * runs: the request schema printed here is the object the validation interceptor
 * parses with, and the response schema is the object the response interceptor encodes
 * through.
 *
 * Request schemas are rendered from their INPUT side (a field with a default is
 * optional to send) and response schemas from their OUTPUT side (the same field is
 * always present in what comes back).
 *
 * better-auth's routes under `/api/auth` are not here: they are the library's API, not
 * controllers in the module graph, and the SPA reaches them through the library's own
 * client.
 */

type Json = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  tags: { name: string }[];
  security: Json[];
  paths: Record<string, Record<string, Json>>;
  components: {
    securitySchemes: Json;
    responses: Json;
    schemas: Record<string, Json>;
  };
}

export interface DocumentOptions {
  title: string;
  version: string;
  /** The session cookie's name, for the security scheme. */
  sessionCookie: string;
}

const SECURITY_SCHEME = 'sessionCookie';
const ERROR_RESPONSE = 'Error';
const JSON_CONTENT = 'application/json';

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No content',
};

const ERROR_TEXT: Record<number, string> = {
  400: 'The request is malformed or failed validation.',
  401: 'No valid session.',
  403: 'The caller may not do this, or the request came from another origin.',
  404: 'No such resource, or none the caller may see.',
  409: 'The write conflicts with the current state, e.g. a stale If-Match (`stale_write`).',
};

export function buildOpenApiDocument(routes: Route[], options: DocumentOptions): OpenApiDocument {
  const components = new ComponentRegistry();
  const paths: Record<string, Record<string, Json>> = {};
  const tags = new Set<string>();

  const ordered = [...routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );

  for (const route of ordered) {
    const tag = tagOf(route);
    tags.add(tag);
    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    (paths[path] ??= {})[route.method.toLowerCase()] = operation(route, tag, components);
  }

  // Registered through the same path as every other schema, so it is rendered and
  // collision-checked like them.
  const errorSchema = components.render(ErrorResponse, 'output');

  return {
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      description:
        'Generated from the Zod contracts in packages/contracts and the route metadata in ' +
        'apps/api. Do not edit: change the code and regenerate with ' +
        '`UPDATE_OPENAPI=1 pnpm --filter @athlete/api run test`.',
    },
    tags: [...tags].sort().map((name) => ({ name })),
    // Every operation needs a session unless it says otherwise (`security: []`).
    security: [{ [SECURITY_SCHEME]: [] }],
    paths,
    components: {
      securitySchemes: {
        [SECURITY_SCHEME]: {
          type: 'apiKey',
          in: 'cookie',
          name: options.sessionCookie,
          description:
            'An httpOnly session cookie set by signing in at /api/auth/sign-in/email. ' +
            'Same-origin browsers send it by themselves; there is no bearer token.',
        },
      },
      responses: {
        [ERROR_RESPONSE]: {
          description: 'Every failed request answers with this one body.',
          content: { [JSON_CONTENT]: { schema: errorSchema } },
        },
      },
      schemas: components.sorted(),
    },
  };
}

/** `AthletesController` -> `athletes`. */
function tagOf(route: Route): string {
  const name = route.controller.replace(/Controller$/, '');
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function operation(route: Route, tag: string, components: ComponentRegistry): Json {
  if (!route.responds) {
    throw new Error(`${route.name} declares no response. Add @Responds(<schema>).`);
  }

  const parameters = [
    ...parametersOf(route, 'params', 'path', components),
    ...parametersOf(route, 'query', 'query', components),
    ...(route.ifMatch
      ? [
          {
            name: 'If-Match',
            in: 'header',
            required: true,
            description:
              'The version being edited, as the ETag of the last read returned it. A write ' +
              'against any other version is refused with 409 `stale_write`.',
            schema: { type: 'string', examples: ['"3"'] },
          },
        ]
      : []),
  ];

  const body = route.validation.body;
  const status = successStatus(route);
  const success: Json = { description: STATUS_TEXT[status] ?? 'Success' };
  if (route.responds.schema) {
    success.content = {
      [JSON_CONTENT]: { schema: components.render(route.responds.schema, 'output') },
    };
  }
  if (route.responds.etag) {
    success.headers = {
      ETag: {
        description: 'The version of the returned resource. Send it back as If-Match to edit it.',
        schema: { type: 'string', examples: ['"3"'] },
      },
    };
  }

  return {
    operationId: `${tag}_${route.handler}`,
    tags: [tag],
    ...(route.isPublic ? { security: [] } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { [JSON_CONTENT]: { schema: components.render(body, 'input') } },
          },
        }
      : {}),
    responses: {
      [String(status)]: success,
      ...Object.fromEntries(
        errorStatuses(route).map((code) => [
          String(code),
          { description: ERROR_TEXT[code], $ref: `#/components/responses/${ERROR_RESPONSE}` },
        ]),
      ),
    },
  };
}

/**
 * Which error statuses a route can answer with, from what it declares. Erring towards
 * listing one a route never sends: an undocumented status is the worse mistake, and
 * every status carries the same body.
 *
 *  - 400  the route validates input, or requires If-Match
 *  - 401  anything but a public route
 *  - 403  anything but a public route (policy, scope, or the origin check)
 *  - 404  the route names a row, by path parameter or in its body
 *  - 409  the route writes
 */
function errorStatuses(route: Route): number[] {
  const validates = Object.keys(route.validation).length > 0;
  const writes = !['GET', 'HEAD', 'OPTIONS'].includes(route.method);
  return [
    ...(validates || route.ifMatch ? [400] : []),
    ...(route.isPublic ? [] : [401, 403]),
    ...(route.validation.params || route.validation.body ? [404] : []),
    ...(writes ? [409] : []),
  ];
}

/**
 * One parameter per property of the slot's schema. A path parameter is always
 * required; a query parameter is required when the schema says so, which with defaults
 * on the input side means: rarely.
 */
function parametersOf(
  route: Route,
  slot: 'params' | 'query',
  location: 'path' | 'query',
  components: ComponentRegistry,
): Json[] {
  const schema = route.validation[slot];
  if (!schema) return [];

  const object = components.renderInline(schema, 'input');
  if (object.type !== 'object' || typeof object.properties !== 'object') {
    throw new Error(`${route.name}: the ${slot} schema must be an object of named parameters.`);
  }
  const required = new Set((object.required as string[] | undefined) ?? []);

  return Object.entries(object.properties as Record<string, Json>).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: property,
  }));
}

/**
 * Renders Zod schemas to JSON Schema and collects the named ones (`.meta({ id })`)
 * under `components.schemas`, so the document refers to `AthleteResponse` once instead
 * of repeating it at every use -- and so a generated client gets one named type.
 */
class ComponentRegistry {
  private readonly schemas = new Map<string, Json>();

  /** The schema as the document should embed it: a `$ref` if named, inline otherwise. */
  render(schema: ZodType, io: 'input' | 'output'): Json {
    const { $defs, ...root } = this.toJsonSchema(schema, io);
    for (const [name, definition] of Object.entries($defs ?? {})) {
      this.register(name, rewriteRefs(definition) as Json);
    }
    return rewriteRefs(root) as Json;
  }

  /** As `render`, but a named root is resolved to its definition (for parameters). */
  renderInline(schema: ZodType, io: 'input' | 'output'): Json {
    const rendered = this.render(schema, io);
    const ref = typeof rendered.$ref === 'string' ? rendered.$ref.split('/').pop() : undefined;
    return ref ? (this.schemas.get(ref) ?? rendered) : rendered;
  }

  sorted(): Record<string, Json> {
    return Object.fromEntries([...this.schemas].sort(([a], [b]) => a.localeCompare(b)));
  }

  private toJsonSchema(schema: ZodType, io: 'input' | 'output'): Json & { $defs?: Record<string, Json> } {
    const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
      io,
      target: 'draft-2020-12',
      // Anything JSON Schema cannot express is an error, not a silent `{}`: a contract
      // the document cannot describe must not be published as "anything".
      unrepresentable: 'throw',
      override: ({ zodSchema, jsonSchema }) => {
        // On the output side Zod marks every object closed. A response object is not:
        // `z.object` responses may gain a field without breaking a client (see
        // `strictObject` in the contracts). Only a schema that really is strict keeps
        // `additionalProperties: false`.
        const def = zodSchema._zod.def as { type: string; catchall?: unknown };
        if (def.type === 'object' && def.catchall === undefined) {
          delete jsonSchema.additionalProperties;
        }
      },
    }) as Json;
    return rest;
  }

  /**
   * One id, one shape. The same id rendered twice must be identical -- a schema used
   * as both a request and a response whose two sides differ (a default, a transform)
   * would otherwise be published as whichever was rendered last.
   */
  private register(name: string, definition: Json): void {
    const existing = this.schemas.get(name);
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
      throw new Error(
        `Schema id "${name}" renders to two different shapes. Two schemas share the id, or ` +
          'one schema is used as both a request and a response and its two sides differ.',
      );
    }
    this.schemas.set(name, definition);
  }
}

/** `#/$defs/X` (where Zod puts named schemas) -> `#/components/schemas/X`. */
function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rewriteRefs);
  if (typeof node !== 'object' || node === null) return node;

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === '$ref' && typeof value === 'string'
        ? value.replace(/^#\/\$defs\//, '#/components/schemas/')
        : rewriteRefs(value),
    ]),
  );
}

/** The committed form: stable key order from construction, two-space JSON, final newline. */
export function serializeOpenApiDocument(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
