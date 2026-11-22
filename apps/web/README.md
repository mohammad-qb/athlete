# apps/web

The typed API client for the SPA, and for now nothing else. There is no Vite app, no
React component and no page here yet: this package holds the generated client, the
configuration that generates it, and a typecheck. The application is built on top of it
in the next phases of [`docs/plans/frontend-v1.md`](../../docs/plans/frontend-v1.md).

## What is here

```
openapi-ts.config.ts          input ../api/openapi.json -> output src/lib/api/generated
src/lib/api/generated/        GENERATED, committed, never edited by hand
  types.gen.ts                request and response types, one per contract schema
  sdk.gen.ts                  one function per route: athletesList, athletesUpdate, ...
  @tanstack/react-query.gen.ts  query options, query keys and mutation options per route
  client.gen.ts, client/, core/  the fetch client the SDK calls through
```

## Where it comes from

```
packages/contracts (Zod)  +  route decorators in apps/api
        -> apps/api/openapi.json        (generated; a test fails when it is stale)
        -> src/lib/api/generated        (generated; CI fails when it is stale)
```

Nothing in that chain is written by hand, so a contract change is a compile error in the
code that calls the API, not a runtime bug in a user's browser. After changing a route
or a schema:

```bash
UPDATE_OPENAPI=1 pnpm --filter @athlete/api run test   # rewrite apps/api/openapi.json
pnpm --filter @athlete/web run generate                # rewrite the client from it
pnpm --filter @athlete/web run typecheck
```

CI runs `generate` and then `git diff --exit-code src/lib/api/generated`.

## What the client knows

- Paths include `/api/v1`, and the client has no base URL: the SPA is served from the
  same origin as the API, so requests are relative and the session cookie travels by
  itself. There is no token to attach.
- A route that edits a versioned resource requires the `If-Match` header by type
  (`athletesUpdate` does not compile without it). The version to send is the `version`
  field of the resource, which is also its `ETag`.
- Every error status is typed as the one shared `ErrorResponse` body.
- List routes take `page`, `pageSize`, `sort` and `q` and answer
  `{ items, total, page, pageSize }`.

It deliberately does not include generated validation schemas. Forms will validate with
the Zod schemas in `@athlete/contracts` directly; a generated copy would be a second
source of truth.

## Why a SPA rather than SSR

This is a deployment decision as much as a frontend one. A static bundle keeps production
at **one Node process**, which is what makes the brief's "single server" and "budget cut
40%" scenarios answerable without redesigning anything. An authenticated internal
platform has no SEO requirement and no public pages, so server rendering would add a
second runtime to deploy, monitor, scale and pay for in exchange for nothing concrete.

See [`docs/01-technology-stack.md`](../../docs/01-technology-stack.md) §6.
