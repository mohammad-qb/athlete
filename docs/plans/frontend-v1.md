# Frontend v1: cookie auth, a generated API client, and the admin + coach SPA

**Goal.** When this plan is done, `apps/web` is a React + Vite static SPA that an
`academy_admin` and a `coach` sign in to and use for everything the API offers today:
athletes (list, create, edit with conflict handling), teams (list, roster, memberships,
transfers) and training sessions (list, create, attendance on a phone). It looks like
shadcn's `dashboard-01` block, light theme only. Behind it, `apps/api` authenticates with
better-auth cookie sessions through its own database role, every route declares a response
schema, lists are paginated on the server, and an `openapi.json` generated from the Zod
contracts drives a hey-api client that CI keeps in step.

**Non-goals.** No `platform_admin` or `athlete` screens, no user or role management UI, no
sign-up, invitations, email, password reset by email or TOTP, no assessments, dashboards or
charts, no dark theme, no Arabic or i18n library (logical CSS classes only), no offline
queue or service worker, no Next.js or SSR, no `drizzle-orm` upgrade, no argon2id (better-auth's
default scrypt stays), no second deployable beyond static files.

## Progress tracker

| Phase | Name | Status |
|---|---|---|
| 1 | Cookie authentication (better-auth, `athlete_auth` role, `/me`) | done |
| 2 | API contract (response schemas, lists, new reads, OpenAPI, generated client) | done |
| 3 | Web foundation (shell, design system, sign-in, athletes list, e2e harness) | not started |
| 4 | Admin screens (athlete create/edit + conflict dialog, teams) | not started |
| 5 | Coach flow (sessions, phone attendance) + docs | not started |

**Current phase:** 2 done (2026-11-22, branch `feat/frontend-v1-phase-2`).
**Recommended next phase:** 3.

Phases are strictly sequential. Stop after phase 3 for the owner to look at the running UI
before building more screens on it.

**At the end of your run, update this tracker.** Set the phase you worked to `done`,
`in progress` or `blocked`, move the two lines above, and add any deviation from the plan as a
one-line bullet under that phase's "Deviations" heading.

## Standing execution rule

At the start of each phase, verify this plan against the live repo and against earlier phases'
recorded deviations: file paths, exported names and library versions may have moved. Do not
reopen the settled decisions below without new evidence. If an assumption turns out to be
wrong, update this document, record the deviation, and surface it in your final message rather
than silently changing direction.

Work on a branch `feat/frontend-v1-phase-<n>` cut from `dev`. Commit with conventional commit
messages (commitlint runs on commit). Do not push or open a PR unless asked.

## Decisions & context

### What this repository is

A technical proposal whose code is evidence for the written argument in `docs/01`–`06` and
`docs/adr/`. Each hard claim is asserted by a test. Two consequences for every phase: a change
that makes a doc sentence false must fix the sentence in the same phase, and a new guarantee
needs a test that fails when it is removed. Read `docs/plans/backend-foundations.md` for how
the existing gates came about; do not edit it.

Existing gates you must keep green and extend rather than bypass:

- **Deny by default.** `AuthorizationGuard` refuses any route without a declaration
  (`apps/api/src/common/authz/`). `apps/api/test/authz.route-coverage.spec.ts` walks the module
  graph, fails on undeclared routes, and generates `docs/reference/route-manifest.md`
  (regenerate with `UPDATE_ROUTE_MANIFEST=1 pnpm --filter @athlete/api run test`).
- **Validation on by default.** `@Validate({ params, query, body })` plus `@ValidBody()` etc.
  (`apps/api/src/common/validation/`). Raw `@Body`/`@Query`/`@Param` fail the build.
- **Privilege matrix.** `PRIVILEGE_MATRIX` in `apps/api/src/common/tenancy/database-privileges.ts`
  is checked at boot; `athlete_app` holds nothing on `users` (ADR 0004).
- **Boundaries.** `.dependency-cruiser.cjs` (`pnpm run lint:boundaries`): SQL only in
  `*.repository.ts`, `packages/contracts` imports no server library.
- **Migrations are hand-written SQL** in `apps/api/drizzle/NNNN_*.sql`, forward only, applied by
  `apps/api/src/db/migrate.ts` as the owner. Drizzle never generates them.
- **Vitest cannot construct real Nest controllers** (esbuild emits no decorator metadata). HTTP
  behaviour of real routes is proven by `scripts/smoke.sh` against the compose stack, not by
  in-process tests. See `docs/01-technology-stack.md` §10.

### Product and scope (settled)

- **One SPA, two roles.** `academy_admin` and `coach` share one app with role-aware navigation
  and landing page. Not two dashboards: roles are per academy (`user_academy_roles`), so one
  person can be a coach in one academy and an admin in another.
- **Responsive.** The coach attendance screen must work at phone width (about 390px).
- **Static SPA, same origin.** Front Door serves the SPA and routes `/api/*` to the API on one
  hostname (`docs/05-deployment.md`). Next.js and TanStack Start were rejected to keep one Node
  process (`docs/01-technology-stack.md` §6).
- **Data residency.** The SPA makes no third-party runtime requests: fonts are self-hosted, no
  analytics, no error-reporting SaaS.

### Authentication (settled)

- **better-auth, pinned exactly** (1.7.27 at planning time), mounted in the Nest API at
  `/api/auth`, email + password only, **public sign-up disabled**.
- **httpOnly cookie sessions stored as database rows.** No bearer token. The current HMAC
  token (`SessionService`, `scripts/mint-token.js`) is deleted, not kept alongside.
- **Cookie cache stays off** (the default), so revoking a session or a role takes effect on the
  next request.
- **Own database role and pool.** better-auth connects as `athlete_auth` through its own
  `pg.Pool`, passed to better-auth directly (its built-in query layer). **Not the Drizzle
  adapter**: that adapter requires `drizzle-orm >= 0.45.2` and the API stays on 0.44.x. The auth
  tables are deliberately absent from `apps/api/src/db/schema.ts`.
- **Active academy lives on the session row** (`active_academy_id`), written only by the
  server. Roles are looked up per request, never cached in the session.
- **CSRF.** SameSite=Lax cookies plus an Origin check on every state-changing request to our own
  routes, in addition to better-auth's check on its routes.
- **Accounts are created by an operator CLI.** v1 screens: sign in, sign out, change password.

Facts about better-auth 1.7 established during planning (verify against the pinned version's
docs before relying on any that is marked unverified):

- It is **ESM-only**; the docs say CommonJS is unsupported. The API compiles to CommonJS
  (`module: node16`). Verified in phase 1: a dynamic `import()` loads it from the built
  output, ts-node-dev and Vitest.
- Express 5 mount: `app.all('/api/auth/*splat', toNodeHandler(auth))` from `better-auth/node`,
  registered **before** any body parser. In Nest that means `NestFactory.create(AppModule, {
  bodyParser: false })` and re-adding parsers afterwards.
- Session lookup: `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`.
- Password hashes live in the account table (`providerId = 'credential'`, `accountId` = user
  id), not on the user row. `(providerId, accountId)` must be unique.
- `advanced.database.generateId: 'uuid'` lets Postgres generate uuid ids; every auth table
  needs `default gen_random_uuid()`.
- `emailAndPassword.disableSignUp: true` also makes the server-side `auth.api.signUpEmail`
  throw, so the CLI needs its own instance with sign-up enabled.
- `POST /api/auth/update-session` accepts additional session fields from the browser when the
  field has `input: true`. `activeAcademyId` must therefore be `input: false` and written by
  our own SQL.
- Direct `auth.api.*` calls skip better-auth's origin checks.
- Defaults: cookies httpOnly + SameSite=Lax, name `<prefix>.session_token`, sessions last 7
  days; `secret` must be 32+ characters; `baseURL` is trusted as an origin.
- Verified in phase 1: `user.fields` / `session.fields` values and an additional field's
  `fieldName` take SQL column names when a `pg.Pool` is passed directly.
- Found in phase 1: the origin check is **off by default when better-auth detects a test
  environment**; set `advanced.disableOriginCheck: false` explicitly. Sign-in is rate
  limited per client address, in memory, when `NODE_ENV=production`. A multi-address
  `X-Forwarded-For` resolves to no address (one shared bucket for everyone) unless
  `advanced.ipAddress.trustedProxies` names the proxies.

### API contract (settled)

- **OpenAPI is generated from the Zod contracts plus route metadata**, never written by hand
  and never via `@nestjs/swagger` DTO classes (rejected in `docs/01-technology-stack.md` §10).
- **Every route declares a response schema**, and responses are encoded through it.
- **`apps/api/openapi.json` and the generated client are committed**; CI fails on drift.
- **hey-api** generates the SDK and TanStack Query options. **Forms import Zod schemas from
  `@athlete/contracts` directly**; hey-api does not generate a second copy of the schemas.
- **Lists use server-side offset pagination**: query `page`, `pageSize`, `sort`, `q`; response
  `{ items, total, page, pageSize }`.
- **Optimistic concurrency is already built**: updates require `If-Match: "<version>"`, the
  version is also in the response body, and a stale write is a 409 with code `stale_write`
  (`apps/api/src/common/http/optimistic-concurrency.ts`).
- **There is no `Idempotency-Key` header in the API.** Attendance replay safety comes from the
  client-generated `clientRecordId` on each entry (`packages/contracts/src/sessions.ts`).
- **The browser never holds the policy.** `GET /me` returns the coarse `(action, subject)` pairs
  the user holds; row-level refusals stay server-side and arrive as 403/404.

### Web application (settled)

- **Stack.** React 19, Vite, TypeScript, Tailwind v4, shadcn/ui (new-york style, neutral base
  colour), TanStack Router (file-based), TanStack Query, TanStack Table, TanStack Form. React
  Hook Form was offered and declined.
- **Look.** Stock shadcn `dashboard-01`
  (<https://ui.shadcn.com/view/new-york-v4/dashboard-01>): inset collapsible sidebar, site
  header, summary cards, table styling, default radius, Geist. Light theme only: no `.dark`
  tokens, no theme toggle. Two tokens are added, `--success` and `--warning`, beside
  `--destructive`. The block's drag-to-reorder rows and demo chart are removed. Custom design
  directions were shown and rejected; do not restyle.
- **Structure.** Thin route files and enforced features:

  ```
  apps/web/src/
    routes/            URL params schema, guard, loader; renders a feature page
    features/<name>/   components/ hooks/ index.ts   (index.ts is the only public surface)
    components/ui/     shadcn primitives
    components/        shared composites (DataTable, ConflictDialog, AppSidebar, form fields)
    lib/               api client, error mapper, auth client, can(), query client, drafts
  ```

  A feature never imports another feature. Code outside a feature imports it only through its
  `index.ts`. dependency-cruiser enforces both.
- **No hand-written query keys.** Use the generated query options; route loaders prefetch.
- **One error mapper** in `lib/` turns the API's typed errors into form field errors, the
  conflict dialog, a redirect to sign-in, or a toast. Screens do not parse errors.
- **409 handling.** One shared conflict dialog: the form stays filled, the dialog shows the
  fields the other person changed beside the user's values, with "Keep mine" (resubmit against
  the new version) and "Take theirs" (reload).
- **Attendance.** Mark everyone, submit once. The draft (statuses plus the `clientRecordId` of
  each entry) is kept in local storage keyed by user, academy and session, and wiped together
  with the query cache on submit, sign-out and academy switch.
- **Language.** English, plain strings. Only logical Tailwind classes (`ms-`, `me-`, `ps-`,
  `pe-`, `start-`, `end-`, `text-start`, `text-end`), enforced by a check.
- **Tests.** Vitest + Testing Library for logic; Playwright against the real API in docker
  compose for three flows: sign-in, an athlete edit that hits a 409, attendance at phone width.

### Library versions at planning time (2026-11-22)

better-auth 1.7.27, @hey-api/openapi-ts 0.99.0, @tanstack/react-router 1.170.x,
@tanstack/react-query 5.108.x, @tanstack/react-form 1.33.x, @tanstack/react-table 9.3.x,
vite 8.3.x, react 19.3.x, tailwindcss 4.3.x, shadcn CLI 4.23.x, @playwright/test 1.65.x. Pin
better-auth exactly; use caret ranges elsewhere. If the shadcn block installs a different
TanStack Table major than the latest, keep the one the block's code is written for.

---

## Phase 1 — Cookie authentication

**Goal.** A person created by the CLI can sign in over HTTP, receive an httpOnly cookie, call
the existing routes with it, read `GET /api/v1/me`, switch academy and sign out. The bearer
token is gone. `athlete_app` still cannot read a credential.

### Do this first: prove better-auth loads

Before any other work, add the dependency and prove that the API can load better-auth in all
three runtimes it uses: the built output (`pnpm --filter @athlete/api run build && node
dist/main.js`), the dev runner (`pnpm dev`, ts-node-dev) and Vitest. Expected approach: a
dynamic `await import('better-auth')` inside an async factory, which `module: node16` leaves as
a real import in CommonJS output; type-only imports of an ESM package from a CommonJS file may
need `with { 'resolution-mode': 'import' }`. If ts-node-dev cannot do it, replace the dev
script with `tsc --watch` plus `node --watch dist/main.js` and record the deviation. If no
arrangement works without converting the API to ESM, stop and mark the phase `blocked` with
what you found; converting the API's module format is the owner's decision.

### What to build

**Migration `apps/api/drizzle/0003_auth.sql`**

- `users`: add `email_verified boolean not null default false`, `image text`,
  `updated_at timestamptz not null default now()`; drop `password_hash`.
- `auth_sessions`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references
  users(id) on delete cascade`, `token text not null unique`, `expires_at timestamptz not null`,
  `ip_address text`, `user_agent text`, `active_academy_id uuid references academies(id) on
  delete set null`, `created_at`, `updated_at`. Index on `user_id`.
- `auth_accounts`: the better-auth account columns in snake_case, `unique (provider_id,
  account_id)`, index on `user_id`.
- `auth_verifications`: the better-auth verification columns, index on `identifier`.
- Role `athlete_auth` (`nologin nobypassrls`, created idempotently like `athlete_app` in
  `0001_rls.sql`). Grants: `select, insert, update` on `users`; `select, insert, update, delete`
  on the three `auth_*` tables. Nothing else, and nothing on these tables for `athlete_app`.
- Replace `app_academies_for_user(uuid)` so it also returns `academy_name` (drop and recreate;
  keep `security definer`, the pinned `search_path` and the execute grant to `athlete_app`
  only). It stays the only SECURITY DEFINER function.

Check the column list against the pinned better-auth version's database docs before writing
the SQL.

**Configuration**

- `packages/config/src/index.ts`: add `AUTH_DATABASE_URL` (url) and `APP_BASE_URL` (url, the
  browser-facing origin). Keep `SESSION_SECRET`; it becomes better-auth's `secret`, so Terraform
  needs no rename.
- `apps/api/src/db/migrate.ts`: generalise `provisionAppRoleLogin` to take a role name; the
  migrate entry point also sets `athlete_auth`'s password from `AUTH_ROLE_PASSWORD`.
- `docker-compose.yml`, `.env.example`, `.env.development` (set values with `dotenvx set`; the
  key is in `.env.keys`), and the Terraform stacks wherever `DATABASE_URL` and `SESSION_SECRET`
  are wired today. `APP_BASE_URL` is `http://localhost:3000` in compose for now and
  `http://localhost:5173` in `.env.development` (the Vite dev origin used from phase 3).

**`apps/api/src/modules/auth/`**

- `auth.factory.ts`: `createAuth({ pool, secret, baseURL, allowSignUp })`. `basePath:
  '/api/auth'`; `emailAndPassword: { enabled: true, disableSignUp: !allowSignUp }`; model names
  `users`, `auth_sessions`, `auth_accounts`, `auth_verifications` with snake_case field
  mappings (`name` to `full_name`); session additional field `activeAcademyId` mapped to
  `active_academy_id` with `input: false`; `advanced.database.generateId: 'uuid'`;
  `advanced.cookiePrefix: 'athlete'`; `trustedOrigins: [baseURL]`; cookie cache not enabled.
- `auth.module.ts`: provides the auth instance (async factory) and the `athlete_auth` pool
  (small, closed on module destroy). Remove `SessionService`.
- `auth-session.store.ts`: the only code that writes `active_academy_id`, through the auth pool.
- `principal.repository.ts`: calls `app_academies_for_user` through
  `DatabaseService.runUnscoped`.
- `authentication.guard.ts` (now async): resolve the cookie to a session; attach
  `request.identity = { userId, email, name, sessionId }`; look up the user's academies and
  roles; the active academy is the session's `activeAcademyId` if the user still holds a role
  there, otherwise the first academy by name, which is then persisted; attach
  `request.principal = { userId, academyId, roles }` for that academy. A signed-in user with no
  academy gets an identity and no principal. The guard still never refuses.
- `me.controller.ts`: `GET /api/v1/me` returns `MeResponse`; `POST /api/v1/me/active-academy`
  takes `{ academyId }`, refuses with 403 when the user holds no role there, updates the
  session and returns the new `MeResponse`.

**Authorization declaration.** `/me` is not an `(action, subject)` pair. Add `@Authenticated()`
to `permission.decorator.ts`, meaning any signed-in identity. `AuthorizationGuard` accepts
exactly one of `@Public`, `@Authenticated`, `@Permission`. Teach the route-coverage spec and
the manifest the third kind (printed as `_authenticated_`).

**Origin check.** A global guard registered before `AuthenticationGuard`: for any method other
than GET, HEAD and OPTIONS, a present `Origin` header that differs from the origin of
`APP_BASE_URL` is refused with an `ApiError` (403, code `invalid_origin`). A request with no
`Origin` header passes (non-browser clients; browsers always send it on these methods).

**`apps/api/src/main.ts`.** Create the app with `bodyParser: false`, mount the better-auth
handler on the underlying Express instance at `/api/auth/*splat`, then re-enable JSON and
urlencoded parsing. Remove `enableCors`: the SPA is same-origin.

**Contracts.** `packages/contracts/src/me.ts`: `MeResponse = { user: { id, email, name },
activeAcademyId, academies: [{ id, name, roles }], permissions: [{ action, subject }] }` and
`SwitchAcademyRequest`. `permissions` lists every pair of `read | create | update | delete` and
subject for which the unscoped ability answers yes; empty when there is no principal.

**Operator CLI.** `apps/api/src/cli/create-user.ts`, script `user:create`. Runs with the owner
connection in `DATABASE_URL`, the same way the migrate job does. Arguments: `--email`,
`--name`, `--academy <uuid>`, `--role <role>`, password from `--password` or stdin. Creates the
user through a `createAuth({ allowSignUp: true })` instance and inserts the
`user_academy_roles` row. Running it again for an existing email adds the role grant only.

**Scripts.** Delete `scripts/mint-token.js`. `scripts/seed-demo.sql` stops inserting
`password_hash`. `scripts/smoke.sh` creates its users with the CLI (`docker compose run --rm
migrate node dist/cli/create-user.js ...`), signs in with a curl cookie jar and uses the jar
where it sent `Authorization` before. Add `scripts/seed-dev.sh` that seeds a local database
with one academy, one admin and one coach for manual use, and document it in the README.

### Tasks

- [x] better-auth loads in built output, dev runner and Vitest (first; may block the phase)
- [x] `0003_auth.sql`, `athlete_auth` role, login provisioning, env and compose wiring
- [x] `createAuth`, auth module, session store, principal repository, async guard
- [x] `@Authenticated`, origin guard, `/me` and `/me/active-academy`, contracts
- [x] `user:create` CLI, `seed-dev.sh`, smoke script on cookies, token code removed
- [x] Tests listed below; route manifest regenerated
- [x] ADR `docs/adr/0006-cookie-sessions-and-the-auth-role.md` (session transport, separate
      role, pg pool instead of the Drizzle adapter, active academy on the session, origin
      check, CLI-only accounts); correct `docs/01-technology-stack.md` §7 and the README's
      "not built" list where this phase makes them false

### Tests to add or change

- `auth.session.integration.spec.ts` (Testcontainers): a CLI-created user signs in and the
  returned cookie resolves to a session; a wrong password is refused; sign-up through the
  server instance is refused; signing out invalidates the cookie; a session's active academy
  that the user no longer holds falls back and is rewritten.
- `privileges.matrix.integration.spec.ts` and `PRIVILEGE_MATRIX`: the three `auth_*` tables are
  listed with no privileges for `athlete_app`; `athlete_app` cannot select from `users` or any
  `auth_*` table; `athlete_auth` cannot select from `athletes` or `user_academy_roles` and
  holds exactly the grants above.
- `authz.guard.unit.spec.ts`: `@Authenticated` admits an identity without a principal and
  refuses an anonymous request; a route with two declarations fails.
- `origin.guard.unit.spec.ts`: foreign origin refused on POST, same origin and absent origin
  admitted, GET never refused.
- `me.unit.spec.ts`: `permissions` for admin and coach match the ability; no principal gives an
  empty list.
- `apps/api/test/support/harness.ts`: provision `athlete_auth`, expose its URL, stop writing
  `password_hash`.

### Exit criteria

```bash
pnpm install --frozen-lockfile
pnpm --filter @athlete/config --filter @athlete/contracts run build
pnpm run typecheck && pnpm run lint && pnpm run lint:boundaries
pnpm run test && pnpm run test:integration
docker compose up -d --build && docker compose run --rm migrate && ./scripts/smoke.sh
docker compose down -v
```

All pass. In addition `smoke.sh` asserts: an unauthenticated request to a protected route is
401; `POST` with `Origin: https://evil.example` is 403 `invalid_origin`; `GET /api/v1/me`
returns the signed-in user's academies and permissions; switching to an academy the user does
not belong to is 403; after sign-out the old cookie is 401. `grep -r "mint-token\|SessionService"
apps scripts` finds nothing. The Terraform CI job's commands still pass if Terraform changed.

### Deviations

- **A defect in `0001` fixed in `0003`, beyond the plan.** `app_academies_for_user()` is
  SECURITY DEFINER and reads two tables under FORCE ROW LEVEL SECURITY, so with a
  non-superuser owner (production) it returned no rows and every sign-in would have
  resolved to "no academy". `0003_auth.sql` gives the migrating role a `SELECT` policy on
  `user_academy_roles` and `academies`. New suite `auth.owner.integration.spec.ts` migrates
  as a non-superuser and fails without it. **Owner to confirm** the concession: the schema
  owner can now read role grants and academy names across tenants without a tenant key.
- **The unverified better-auth facts all held**, with one addition: it loads from CommonJS by
  dynamic `import()` in all three runtimes (ts-node-dev kept); `fieldName` and `fields` take
  SQL column names with a `pg.Pool`. New fact: better-auth disables its origin check when it
  detects a test environment, so `createAuth` sets `disableOriginCheck: false` and
  `disableCSRFCheck: false` explicitly.
- **`createAuth` also sets `autoSignIn: false` and `telemetry: { enabled: false }`.** The
  first so the CLI leaves no session behind; the second for the data-residency rule.
- **`PrincipalRepository.academiesFor(tx, userId)` takes the transaction**; the guard opens
  it with `DatabaseService.runUnscoped`. A repository importing `database.service.ts` trips
  the `no-repository-to-service` boundary, and `PrincipalScopeRepository` already follows
  this shape.
- **Files the plan did not name:** `auth.gateway.ts` (the API's two-method view of
  better-auth: node handler, cookie to session), `auth.database.ts` (the `athlete_auth`
  pool), `mount-auth.ts` (called from `main.ts`), `current-session.decorator.ts`
  (`@CurrentSession()`), `me.service.ts` (controllers may not hold logic or reach a store).
- **The guard forwards better-auth's `Set-Cookie`** from the session lookup (`returnHeaders`),
  so a renewed session's cookie expiry reaches the browser. A direct `auth.api` call
  otherwise drops it.
- **`AuthorizationGuard` answers 403, not 401, to a signed-in user with no academy** on a
  `@Permission` route: signing in again would not help.
- **`permissions` in `MeResponse` is typed `PermissionAction`** (`Action` without `manage`),
  exported from the contracts, so the wildcard cannot be reported.
- **`MeService.switchAcademy` refuses with code `not_a_member`**, and `POST
  /me/active-academy` answers 200 rather than Nest's default 201.
- **The CLI needs only `DATABASE_URL`.** It signs nothing, so it uses a throwaway secret
  instead of `SESSION_SECRET`. It sets the tenant key for the academy check and the role
  grant, because a non-superuser owner is bound by RLS. It prints the user id on stdout.
- **The CLI gives a password to a `users` row that has none.** "Adds the role grant only"
  holds for an email that has a credential. A row from before this phase has none (the old
  `seed-demo.sql` inserted users directly), and granting it a role would leave a person who
  can never sign in. For such a row the password is required and is attached to the existing
  id, by the library's own hash and `linkAccount`; `auth.session.integration` asserts it.
- **`scripts/seed-demo.sql` no longer creates users or the coach assignment.** An account
  needs a hash only better-auth writes, so `seed-dev.sh` runs the SQL, creates the two
  accounts with the CLI, then inserts the assignment. `smoke.sh` calls `seed-dev.sh` and adds
  Beta's administrator and a user in both academies.
- **`smoke.sh` waits out better-auth's sign-in rate limit** (retry on 429) and asserts that a
  burst is limited, instead of disabling it. Checks beyond the exit criteria: a successful
  academy switch, `update-session` cannot move the tenant, sign-up is closed, the cookie is
  httpOnly.
- **Compose sets `APP_BASE_URL` to `http://localhost:${API_PORT:-3000}`**, so a stack on
  another port still has a matching origin.
- **Terraform:** a second generated password (`auth_role`), secrets `auth-database-url` (API)
  and `auth-role-password` (migration job), per-secret reader assignments, a `base` output
  `app_base_url` (custom domain or the Front Door host) and a container-app module variable
  that passes it as `APP_BASE_URL`. `fmt`, `validate`, the mocked-provider tests and `tflint`
  were run in containers and pass; nothing was planned or applied.
- **`AUTH_TRUSTED_PROXIES` (review finding, owner's choice).** A new optional env var,
  comma-separated IPs or CIDR ranges, passed to better-auth as `trustedProxies` so the
  sign-in rate limit resolves a client address behind Front Door. Terraform fills it from
  the `AzureFrontDoor.Backend` service tag. Empty locally and in compose.
- **Docs corrected beyond the two the plan names:** `docs/02-architecture.md` and
  `docs/03-data-model.md` (sentences about the token, `password_hash` and the lookup),
  `infra/terraform/README.md`, the README's diagrams, test table and verified state.

---

## Phase 2 — API contract

**Goal.** The API describes itself: every route has a response schema, lists are paginated,
the reads the screens need exist, and `apps/api/openapi.json` generates a typed client in
`apps/web` that CI keeps current.

### What to build

**Response declarations.** A `@Responds(schema, { status? })` decorator in
`apps/api/src/common/validation/` and a global interceptor that encodes the handler's result
through the schema; a result that does not fit is an `INTERNAL` error with code
`response_contract_violation`, never a leaked shape. The route-coverage spec fails any route
without `@Responds` (204 routes declare an empty response) and the manifest gains a "Responds"
column. Add response schemas to `packages/contracts` for every existing route that lacks one.
Give each named schema a stable id with Zod's `.meta({ id })` so the document can reference it.

**List contract** in `packages/contracts/src/primitives.ts`:

- `listQueryOf(sortable, defaultSort)`: strict object `{ page: int >= 1 = 1, pageSize: int
  1..100 = 25, sort: one of the sortable keys optionally prefixed with '-', q?: trimmed string
  up to 100 }`, coerced from query strings.
- `pageOf(item)`: `{ items, total, page, pageSize }`.

**Routes**

| Route | Change |
|---|---|
| `GET /athletes` | Paginated. Sort by `lastName`, `firstName`, `dateOfBirth`, `createdAt`; `q` matches first or last name, case-insensitive |
| `GET /teams` | New. Paginated, sort by `name`, `q` on name |
| `GET /teams/:id` | New. Needed so a roster page can be deep-linked |
| `GET /sessions` | New. Paginated, sort by `startsAt` (default newest first), optional `teamId`, `from`, `to` |
| `GET /sessions/:id` | New. Needed so the attendance page can be deep-linked |

`GET /teams/:id` and `GET /sessions/:id` go beyond the three routes agreed in discussion; they
are the minimum for deep links. Every list and read filters through `accessibleBy` exactly as
`AthletesRepository` does today, and `total` is counted with the same predicate so a coach's
total never reveals rows outside their scope. Use the permissions the ability already grants
(`read` on `teams`, `trainingSessions`).

**OpenAPI generation.** Move the module-graph walk out of the route-coverage spec into a module
under `apps/api/src/openapi/` used by both the spec and a generator. The generator emits an
OpenAPI 3.1 document: paths with the global prefix, `operationId` as `<controller>_<handler>`
(for example `athletes_list`), request schemas from `@Validate` (input side), response schemas
from `@Responds` (output side) via `z.toJSONSchema`, named schemas under `components`, the
`If-Match` request header and `ETag` response header on routes that use them, the shared error
body for 400/401/403/404/409, and cookie auth as the security scheme (none on `@Public`
routes). The better-auth routes under `/api/auth` are not part of the document. Output:
`apps/api/openapi.json`, committed. A spec fails when the file differs from what the code
generates; `UPDATE_OPENAPI=1 pnpm --filter @athlete/api run test` rewrites it, matching the
route-manifest convention. If the error body's wire shape is not yet a Zod schema in
`packages/contracts`, put it there.

**Generated client.** Create `apps/web` as a minimal workspace package `@athlete/web` holding
only: `package.json`, `tsconfig.json`, `openapi-ts.config.ts` (input `../api/openapi.json`,
output `src/lib/api/generated`, fetch client, SDK, TypeScript types, TanStack Query plugin),
the committed generated output, and scripts `generate` and `typecheck`. No Vite app yet. Keep
`apps/web/README.md` accurate.

**CI.** Add a step: run `pnpm --filter @athlete/web run generate`, then
`git diff --exit-code apps/web/src/lib/api/generated` .

### Tasks

- [x] `@Responds`, encoding interceptor, coverage rule, manifest column
- [x] Response schemas and ids across `packages/contracts`
- [x] List contract; `GET /athletes` paginated; four new read routes with scoped totals
- [x] OpenAPI generator, committed document, drift spec
- [x] `@athlete/web` package with generated client, CI drift step
- [x] `smoke.sh` updated for the paginated shape and the new routes; README counts updated

### Tests to add or change

- Integration: a coach's `GET /athletes`, `/teams` and `/sessions` return only rows in scope
  and a `total` equal to that count; `q`, `sort` and paging behave; a team or session outside
  scope is 404 by id.
- Unit: `listQueryOf` coercion, defaults and rejections; the encoding interceptor strips an
  undeclared field and turns a missing required field into `response_contract_violation`.
- Route coverage: a fixture route without `@Responds` fails.
- OpenAPI: the document validates as OpenAPI 3.1 and contains every route in the manifest.

### Exit criteria

```bash
pnpm install --frozen-lockfile
pnpm --filter @athlete/config --filter @athlete/contracts run build
pnpm run typecheck && pnpm run lint && pnpm run lint:boundaries
pnpm run test && pnpm run test:integration
pnpm --filter @athlete/web run generate && git diff --exit-code apps/web/src/lib/api/generated apps/api/openapi.json
docker compose up -d --build && docker compose run --rm migrate && ./scripts/smoke.sh
docker compose down -v
```

All pass. `docs/reference/route-manifest.md` lists the new routes with a response for each.

### Deviations

- **A route with no `@Responds` is refused at runtime, before its handler runs** (500,
  `response_not_declared`), as well as failing the coverage spec. The plan asked only for
  the spec; this is the same fail-closed rule `@Validate` already has.
- **`@Responds` owns the status and the ETag.** `{ status }` is applied to the route
  (`HttpCode`) as well as documented, replacing `@HttpCode(200)` on `/me/active-academy`.
  `{ etag: true }` makes the interceptor send the encoded body's `version` as `ETag`, so
  controllers no longer touch `@Res`. `@Responds(null)` is the 204 form. It is
  handler-level only.
- **New `@IfMatch()` parameter decorator** (`common/http/if-match.decorator.ts`) replaces
  `@Headers('if-match')` + `parseIfMatch` in the controller. The route walk recognises it,
  which is how the document knows where `If-Match` is required without a second list.
- **The encoding interceptor is registered last (innermost)**, so a contract violation is
  thrown inside the tenant transaction and rolls the write back.
- **`GET /sessions` has no `q`.** The plan's table lists none and a session has nothing to
  search; `SessionListQuery` omits it, so `?q=` is a 400 instead of an ignored parameter.
  `from`/`to` are the half-open period `[from, to)` over `startsAt`.
- **`GET /teams/:id` and `GET /sessions/:id` answer 404 outside scope** (as the plan's
  tests ask), where `GET /athletes/:id` answers 403. A coach with no current team gets
  403 `AUTHZ_NO_GRANT` on all of them, lists included, as before.
- **Handlers renamed** so operation ids read well: `TeamsController.createTeam` is now
  `create`. Operation ids are `<controller>_<handler>` with the `Controller` suffix
  dropped and a lower-case first letter (`athletes_list`, `me_switchAcademy`).
- **Error statuses in the document are derived, and err towards listing one.** 400 when
  the route validates or takes `If-Match`; 401 and 403 unless `@Public`; 404 when it names
  a row by path parameter or body; 409 when it writes.
- **Response objects are published open.** Zod marks every object `additionalProperties:
  false` on the output side; the generator removes that for non-strict objects, matching
  the contracts' rule that a response may gain a field. Request objects stay closed.
- **Schemas beyond the routes' own got ids too:** `Role`, `AttendanceStatus`, `Subject`,
  `PermissionAction`, `ErrorType`. New contract files `errors.ts` (`ErrorResponse`,
  `ErrorType`, `FieldError`, `ValidationErrorMeta`) and `health.ts`. The API's
  `ApiErrorType` and `ApiErrorResponse` are now tied to them by type. `FieldError` and
  `ValidationErrorMeta` are exported for the web error mapper but are not in
  `openapi.json`: `meta` is an open record there, since its shape depends on `code`.
- **Files the plan did not name:** `src/openapi/routes.ts` (the walk) and
  `src/openapi/document.ts` (the generator); `common/db/listing.ts` (order by, LIKE
  escaping, page window); `common/validation/response.interceptor.ts`. Specs:
  `openapi.document.unit`, `response.http` (added to the `test` script's filter),
  `contracts.lists.unit`, `lists.pagination.integration`.
- **No generator CLI.** The document is written by the drift spec under `UPDATE_OPENAPI=1`,
  as the plan's convention says; there is no separate script.
- **New dev dependency `@seriousme/openapi-schema-validator`** (API), for the "validates
  as OpenAPI 3.1" test. ESM-only, loaded by dynamic `import()` like better-auth.
- **hey-api 0.99.0 as planned;** its fetch client is generated into the output folder, so
  `@athlete/web` has one runtime dependency, `@tanstack/react-query`. It needs Node
  >= 22.18, so the root `engines.node` moved from `>=22.12.0` to `>=22.18.0`.
- **The CI step diffs the client only**, as the plan words it. `openapi.json` drift is
  caught one step earlier by the unit tests.
- **The sessions contract comment no longer mentions an `Idempotency-Key` header**, which
  the API never had. `docs/01` §5 still names it as a REST mechanic; left for phase 5.
- **Docs corrected in this phase** (sentences this phase made false): `README.md` (counts,
  smoke listing, test table, "not built", layout), `docs/01` §10, `docs/02`
  (cross-cutting table), `docs/03` §4 (routes, lists, responses), `docs/06` (next steps),
  `apps/web/README.md`.

---

## Phase 3 — Web foundation

**Goal.** A person opens the app, signs in, lands in the dashboard-01 shell with the right
menu for their role, switches academy, browses the athletes list with search, sort and paging
in the URL, changes their password and signs out. The patterns every later screen reuses
exist once. A Playwright test proves sign-in against the real stack.

### What to build

**Scaffold.** Turn `apps/web` into a Vite + React + TypeScript app: Tailwind v4 through its Vite
plugin, `@/` path alias, TanStack Router's Vite plugin with file-based routes, TanStack Query.
Dev server proxies `/api` to `http://localhost:3000`. Add root scripts so `pnpm dev` still runs
the API and `pnpm dev:web` runs the SPA; wire `build`, `typecheck`, `lint` and `test` into
Turborepo.

**Design system.** `shadcn init` (new-york, neutral, CSS variables), then add the
`dashboard-01` block. If the installed shadcn CLI offers an RTL / logical-classes setting in
`components.json`, turn it on before adding components. Then: delete the `.dark` token block
and any theme toggle; add `--success` and `--warning` (with foregrounds) and matching badge
variants; self-host Geist (for example `@fontsource-variable/geist`), no font CDN; remove the
block's chart, drag-to-reorder and demo data along with the dependencies only they needed.

**Routes**

```
routes/__root.tsx
routes/sign-in.tsx
routes/_app.tsx                 layout; beforeLoad loads /me or redirects to /sign-in
routes/_app/index.tsx           redirects to the role's landing page (/athletes for now)
routes/_app/athletes.index.tsx  search params validated with the contracts list schema
routes/_app/account.tsx         change password
```

**`lib/`**

- `api/client.ts`: configures the generated client (same-origin credentials) and converts
  non-2xx responses into one typed error class carrying `status`, `type`, `code`, field paths
  and `meta`.
- `api/errors.ts`: the error mapper. Validation errors go to the matching form fields; 409
  `stale_write` invokes the conflict handler; 401 clears state and redirects to sign-in; 403,
  404 and 5xx produce consistent toasts. Unknown codes fall back to the server's message.
- `auth/auth-client.ts`: better-auth's React client pointed at `/api/auth` for sign-in,
  sign-out and change-password.
- `authz/can.ts` and `<Can>`: read `permissions` from the `/me` query.
- `session-reset.ts`: clears the query cache and all local drafts; called on sign-out, on
  academy switch and on a 401.
- `query-client.ts`.

**`components/`**

- `app-sidebar.tsx`, `site-header.tsx` from the block, with real navigation filtered by
  `can()`, an academy switcher (shown when the user has more than one academy; calls
  `POST /me/active-academy`, then `session-reset`), and a user menu (account, sign out).
- `data-table/`: one DataTable in TanStack Table manual mode. Page, page size, sort and search
  come from and write to the route's search params; search is debounced; loading, empty and
  error states are built in.
- `form/`: field wrappers binding TanStack Form to shadcn inputs, labels and error text, with a
  hook for applying server field errors.

**Features.** `features/auth` (sign-in page, change-password form) and `features/athletes`
(list page only; create and edit arrive in phase 4). Each exposes pages through `index.ts`.

**Boundaries.** Extend `.dependency-cruiser.cjs` and the `lint:boundaries` script to cover
`apps/web/src`:

- a file in `features/X` may not import from `features/Y`;
- outside `features/X`, only `features/X/index.ts` may be imported;
- `components/ui` imports nothing from `features`, `routes` or `lib/api`;
- `lib` imports nothing from `features` or `routes`.

**Lint.** A `react` flat config in `tooling/eslint-config` used by `apps/web`, keeping the
type-aware promise rules. A logical-classes check (a small Vitest spec scanning `src/**`, or a
lint rule if one supports Tailwind v4) that fails on `ml-`, `mr-`, `pl-`, `pr-`, `left-`,
`right-`, `text-left`, `text-right`, `border-l`, `border-r`, `rounded-l`, `rounded-r`. If the
shadcn-generated files cannot comply, exclude `components/ui` only and record the deviation.

**End-to-end harness.** Add a `web` service to `docker-compose.yml` that serves the built SPA
and proxies `/api` to the API on one origin (mirroring Front Door), and set the API's
`APP_BASE_URL` to that origin. Add Playwright to `apps/web` with one spec, and a CI job that
builds the stack, migrates, seeds users with the CLI and runs it.

### Tasks

- [ ] Vite app, router, query client, proxy, Turborepo and root scripts
- [ ] shadcn + dashboard-01, light only, status tokens, self-hosted font, demo parts removed
- [ ] `lib/` (client, error mapper, auth client, `can`, session reset)
- [ ] Shell: sidebar, header, academy switcher, user menu
- [ ] DataTable and form field wrappers
- [ ] Sign-in, account, athletes list
- [ ] Boundary rules, React lint config, logical-classes check
- [ ] Unit tests, compose `web` service, Playwright sign-in spec, CI job
- [ ] `apps/web/README.md` rewritten to describe what now exists

### Tests

- Vitest: error mapper (each branch), `can()` and `<Can>`, session reset, DataTable reading and
  writing search params, sign-in form validation.
- Playwright `sign-in.spec.ts`: wrong password shows an error; an admin signs in, sees the
  athletes list, searches, pages and reloads with the same view; signs out and is returned to
  sign-in; a signed-out visit to `/athletes` redirects to sign-in.
- A deliberate cross-feature import makes `pnpm run lint:boundaries` fail (verify once, do not
  commit).

### Exit criteria

```bash
pnpm install --frozen-lockfile
pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run lint:boundaries
pnpm run test && pnpm run test:integration
docker compose up -d --build && docker compose run --rm migrate && ./scripts/smoke.sh
pnpm --filter @athlete/web run test:e2e
docker compose down -v
```

All pass. `grep -rn "dark:" apps/web/src` and a search for a `.dark` block find nothing. The
built SPA requests nothing from a third-party host (check the Playwright network log or the
built HTML and CSS). Take screenshots of sign-in and the athletes list at 1280px and 390px and
include their paths in your final message. **Stop here for the owner's review.**

### Deviations

_None yet._

---

## Phase 4 — Admin screens

**Goal.** An admin can do everything the API allows with athletes and teams, including
resolving an edit conflict.

### What to build

- **`features/athletes`:** create (dialog or page, form validated by `CreateAthleteRequest`),
  detail and edit at `routes/_app/athletes.$athleteId.tsx` (form validated by
  `UpdateAthleteRequest`, sends `If-Match` from the loaded `version`). Create and Edit controls
  are wrapped in `<Can>`.
- **`components/conflict-dialog.tsx`:** generic over a record type. On `stale_write` it fetches
  the current record, shows only the fields that differ between the user's values, the version
  they loaded and the current version, and offers "Keep mine" (resubmit with the new version)
  and "Take theirs" (reset the form to the current record). Wired through the error mapper so
  any edit form gets it by passing its field labels.
- **`features/teams`:** list (`routes/_app/teams.index.tsx`), create, and a team page
  (`routes/_app/teams.$teamId.tsx`) showing the roster with the API's as-of query, adding a
  membership and transferring an athlete between teams. Read
  `packages/contracts/src/teams.ts` and the teams controller for the exact shapes; the temporal
  rules (no overlapping memberships) are enforced by the database and surface as typed errors
  that the error mapper must present clearly.
- Selecting an athlete or a team inside another feature's form (for example the transfer
  dialog) uses a shared picker in `components/` built on the generated query options, not an
  import from the other feature.
- Navigation entries for Teams, filtered by `can()`.

### Tasks

- [ ] Athlete create, detail and edit with `If-Match`
- [ ] Conflict dialog and its error-mapper wiring
- [ ] Teams list, create, roster, add membership, transfer
- [ ] Shared pickers; navigation
- [ ] Unit tests and the Playwright conflict spec

### Tests

- Vitest: conflict dialog (differing fields only, both actions), athlete form mapping of server
  validation errors to fields, transfer form.
- Playwright `athlete-conflict.spec.ts`: two browser contexts open the same athlete; the first
  saves; the second saves, sees the conflict dialog with the first user's change, chooses "Keep
  mine" and the save succeeds; repeat choosing "Take theirs".
- Playwright: a coach does not see Create or Edit controls that `permissions` excludes.

### Exit criteria

The phase 3 command block passes, including the new Playwright specs. Every screen works at
1280px and 390px without horizontal page scroll.

### Deviations

_None yet._

---

## Phase 5 — Coach flow and docs

**Goal.** A coach signs in on a phone, sees their sessions, opens one, marks everyone and
submits the register once, safely across reloads and retries. The written proposal matches
the code.

### What to build

- **`features/sessions`:** list (`routes/_app/sessions.index.tsx`, default upcoming and recent
  for the coach's teams) and create (form validated by `CreateSessionRequest`, team picker).
- **Attendance register** at `routes/_app/sessions.$sessionId.attendance.tsx`: loads the
  session, the team roster as of the session start, and the entries already recorded
  (`GET /sessions/:id/attendance`). Each athlete not yet recorded gets a present / late / absent
  control (use the values of `AttendanceStatus` in contracts) and an optional note. A sticky
  footer shows how many are marked and submits once. Already recorded entries are shown
  read-only; correcting one is out of scope because voiding has no route.
- **`lib/drafts.ts`:** local-storage drafts keyed by user id, academy id and session id,
  holding status, note and a `clientRecordId` generated once per athlete. A reload restores the
  draft; a failed submit keeps it so a retry sends the same ids; success deletes it;
  `session-reset` deletes all drafts. Storage errors are tolerated.
- **Coach landing:** `routes/_app/index.tsx` sends a user whose permissions lack athlete
  creation to `/sessions`, others to `/athletes`.
- **Docs.** Bring the proposal in line with the code: `docs/01-technology-stack.md` (§5 OpenAPI
  now generated, §6 client now built, §7 auth integrated), `README.md` (what is built, how to
  run the web app, test table, route and smoke counts), `apps/web/README.md`,
  `docs/06-decision-summary.md`, and ADRs for decisions not yet recorded: the generated
  contract pipeline, and the web architecture (thin routes, enforced features, server-held
  policy). Mark this plan complete in the same style as `backend-foundations.md`.

### Tasks

- [ ] Sessions list and create
- [ ] Attendance register, drafts, submit and retry behaviour
- [ ] Coach landing and navigation
- [ ] Unit tests and the Playwright attendance spec at phone width
- [ ] Docs, ADRs, plan marked complete

### Tests

- Vitest: drafts (restore, same `clientRecordId` after reload, wiped by session reset, storage
  failure tolerated), register counting and submit payload.
- Playwright `attendance.spec.ts` at a 390px viewport: a coach signs in, lands on sessions,
  opens one, marks half, reloads and finds the marks, marks the rest, submits; the register
  then shows recorded entries; a forced network failure on the first submit followed by a retry
  produces no duplicate entries; signing out removes the draft from local storage.
- Integration (API), if not already covered: replaying the same `clientRecordId` is a no-op.

### Exit criteria

The phase 3 command block passes with all three Playwright flows. Every doc sentence about the
frontend, authentication and OpenAPI is true of the code; `grep -rn "Not integrated\|would be"
docs/01-technology-stack.md apps/web/README.md` returns nothing that is now false.

### Deviations

_None yet._
