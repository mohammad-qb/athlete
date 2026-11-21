# apps/web

Build target for the SPA. **Deliberately minimal** — the brief states that frontend
design is not being assessed, so the time went into the guarantees in `apps/api`
instead.

## What this would be

- **React + Vite**, built to static files, served from Blob Storage behind Front Door.
- API client **generated from the OpenAPI document**, which is itself generated from
  `packages/contracts` — so a contract change is a compile error here, not a runtime bug
  in a user's browser.
- `ETag` captured on read and sent back as `If-Match` on write, surfacing a 409 as
  "someone else changed this — here is their version" rather than as a generic failure.

## Why a SPA rather than SSR

This is a deployment decision as much as a frontend one. A static bundle keeps production
at **one Node process**, which is what makes the brief's "single server" and "budget cut
40%" scenarios answerable without redesigning anything. An authenticated internal
platform has no SEO requirement and no public pages, so server rendering would add a
second runtime to deploy, monitor, scale and pay for in exchange for nothing concrete.

See [`docs/01-technology-stack.md`](../../docs/01-technology-stack.md) §6.
