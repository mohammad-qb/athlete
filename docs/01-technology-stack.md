# A. Technology Selection

> The brief says: *"Do not select technologies simply because they are popular or
> familiar."* Taken seriously, that is not an instruction to pick unusual tools — it is
> an instruction to be able to name the alternative and the trade-off. Boring,
> well-understood technology is the correct answer for a small team; it just has to be
> argued rather than assumed. Where a popular default loses below, it loses on a
> specific technical ground, not on taste.

## Summary

| Layer | Choice | Primary reason |
|---|---|---|
| Runtime / framework | **NestJS + TypeScript** | One language across API and client; module structure answers "how is business logic organised" |
| Repository | **pnpm workspaces + Turborepo** | Shared Zod contracts between API and SPA; cached CI tasks; nothing exotic to defend |
| Database | **PostgreSQL 17** | RLS, GiST exclusion constraints over `tstzrange`, JSONB — three features this domain needs |
| Data access | **Drizzle ORM** | SQL-first; migrations are editable `.sql`, which the guarantees require |
| API | **REST + OpenAPI generated from Zod** | Readable without running it; `ETag`/`Idempotency-Key` are native; integrations free |
| Client | **React + Vite SPA, static** | Keeps production at ONE Node process |
| Auth | **better-auth, self-hosted, own Postgres** | Identity PII stays in the UAE; flat cost |
| Authorization | **CASL ability + a small condition→SQL compiler** | One policy gates routes and filters queries; see [02](./02-architecture.md) |
| Hosting | **Azure UAE North + UAE Central** | Only provider with in-country primary *and* in-country DR |
| IaC | **Terraform** | Keeps the portability claim credible |
| Observability | **OpenTelemetry → Application Insights** | Telemetry stays in-region; vendor-neutral instrumentation |
| Tooling | **Zod, Vitest, type-aware ESLint** | Each replaces a framework default on a stated ground; see [§10](#10-tooling-defaults-named) |

## 1. Runtime and framework — NestJS + TypeScript

**Why.** The decisive constraint in the brief is "a small development team". One
language across API and SPA means one toolchain, one dependency graph, one hiring pool
and one set of types — and with shared Zod contracts, a contract change becomes a
compile error rather than a production bug. Nest's module system also gives a direct,
demonstrable answer to Section B's "how is business logic organised".

**Alternatives considered.**

- **Django (Python)** — genuinely strong here: mature migrations, `django-simple-history`,
  and a free admin panel that academy staff could actually use. Rejected because it
  means a second language alongside the SPA, losing the shared-contract benefit that
  justifies TypeScript end-to-end.
- **.NET 9 / ASP.NET Core** — best typed story of the three, EF Core has first-class
  optimistic concurrency, and a deep UAE enterprise hiring pool. Rejected on the same
  two-language ground, and because the "small team, one deployable" narrative is harder
  to tell.
- **Spring Boot** — Hibernate Envers would give audit history nearly free. Rejected as
  the heaviest option to operate for a team this size.

**Trade-off accepted.** Node's single-threaded model means a CPU-heavy report can block
the event loop. Mitigated by keeping aggregation in Postgres, and by the documented
option of a second worker process — which is why the schema and container are already
shaped for one.

## 2. Repository — pnpm workspaces + Turborepo

Monorepo and monolith are **independent** decisions, and conflating them is a common
error: this is one repository containing one deployable, not a repository of
microservices.

Two concrete justifications, not fashion:

1. **`packages/contracts`** holds Zod schemas as the single source of truth for request
   and response shapes. Validation, the OpenAPI document and the SPA's typed client all
   derive from it. Without this, choosing TypeScript end-to-end pays a cost and collects
   no benefit.
2. **Enforceable boundaries.** A modular monolith rots the day someone imports
   `assessments/internals` from `athletes`. `dependency-cruiser` in CI makes that a red
   build.

**Nx** was considered and rejected on cost/benefit for a 2–3 day exercise: its
`enforce-module-boundaries` with tags is excellent, but pnpm workspaces plus
dependency-cruiser delivers the same guarantee with far less tooling to justify.
**Nest's built-in monorepo mode** is Nest-only, so it cannot host the SPA and would
forfeit the shared contracts.

A monorepo makes *coordinated* change easy but does **not** remove the need for
backward-compatible deploys — browsers hold cached bundles, and any future mobile build
calls yesterday's API.

## 3. Database — PostgreSQL 17

Chosen for three capabilities this domain specifically needs, not as a default:

1. **Row-Level Security** — tenant isolation that holds when a query is written badly.
2. **GiST exclusion constraints over `tstzrange`** — overlapping team memberships become
   *impossible* rather than *validated against*. Section C asks us to demonstrate
   preserved data integrity; a database-enforced temporal constraint is a stronger
   answer than application code.
3. **JSONB** — per-sport assessment metrics (sprint splits, shot accuracy) without an
   EAV schema or a column per sport, with a GIN index for querying inside them.

**MySQL** offers none of the three. **MongoDB** is actively wrong for a brief whose
Section C is a relational-integrity question: historical periods, cross-entity
constraints and concurrent-update semantics are precisely what it makes hard.
**SQL Server** has built-in temporal tables and would be a real contender, but brings
licensing cost and a weaker fit with the rest of this stack.

**Trade-off accepted.** RLS requires the app to connect as a non-owner `NOBYPASSRLS`
role and to run every request inside a transaction. Both are real constraints; both are
cheap at this scale.

## 4. Data access — Drizzle ORM

**Why.** Migrations are plain `.sql` files that can be hand-edited — which is not a
preference but a requirement. RLS policies, `FORCE ROW LEVEL SECURITY`, GiST exclusion
constraints, generated `tstzrange` columns and `SECURITY DEFINER` functions cannot be
expressed in a high-level schema DSL, and they are where every guarantee in this design
lives. Drizzle's typed query builder stays close to SQL, so a reviewer can read what
will actually execute.

**Prisma** — the popular TypeScript default, and rejected on technical grounds rather
than contrarianism: `schema.prisma` cannot express exclusion constraints or RLS
policies, its per-request `SET LOCAL` story fights its connection pooling, and it has no
down migrations. It would mean fighting the tooling at exactly the three points being
assessed.

**TypeORM** — Nest's historical default; unreliable migration generation and a shaky
maintenance history. "It's what the Nest docs use" is the definition of choosing by
familiarity.

**Kysely** — a close second and a legitimate alternative: maximum SQL control, excellent
types. Drizzle was preferred for less boilerplate on ordinary CRUD at equivalent
transparency.

## 5. API style — REST + OpenAPI generated from the Zod contracts

**Why.** The panel can read a spec without running it; `ETag`/`If-Match` (the
optimistic-concurrency answer) and `Idempotency-Key` (the offline-write answer) are
native REST mechanics rather than bolt-ons; responses are cacheable at the edge; and a
future academy integration costs nothing. Type safety is preserved because the client is
generated from the same Zod schemas the server validates with.

**tRPC** — best DX for a TS monorepo and the fastest path to a working app. Rejected
because there is no language-agnostic contract, and `ETag`/idempotency semantics sit
awkwardly on an RPC-shaped transport.

**GraphQL** — attractive for dashboard screens that need athletes, sessions and
assessments in one round trip. Rejected deliberately: N+1 queries inside RLS
transactions, per-field authorization layered on top of a role model already enforced in
services, weaker HTTP caching, and depth/complexity limits to maintain. For one
first-party client at this scale it is complexity without business benefit — the exact
pattern the brief's final discussion scenario targets.

## 6. Client — React + Vite SPA, served as static files

**Why.** Production stays **one Node process**. That is a deployment decision as much as
a frontend one: when the budget is cut 40% or the application must run on a single
server, there is no second runtime to defend. For an authenticated internal platform
there is no SEO requirement and no public page, so SSR would buy nothing concrete.

**Next.js** — better DX and the obvious default. Rejected because no benefit it delivers
*for an authenticated dashboard* justifies a second deployable.

Responsive web covers phones. Native mobile is deferred with a documented Expo path that
reuses `packages/contracts`.

**What is built.** `apps/web` is that SPA: React 19, Vite, TanStack Router, Query, Table
and Form, shadcn/ui. So far it holds the foundation every screen reuses (the generated
client, one error mapper, permissions read from `GET /me`, a server-driven list table,
form fields that take the server's validation messages) and the first screens: sign in,
change password, and the athletes list. Its structure is enforced like the API's: thin
routes over features that may not import each other, checked by dependency-cruiser. In
the compose stack an nginx container serves the bundle and proxies `/api`, reproducing
the single origin Front Door provides; it is a local stand-in, not a second deployable.
See [`apps/web/README.md`](../apps/web/README.md).

## 7. Authentication — better-auth, users in our own Postgres

**Why self-hosted.** Two hard constraints decide this. **Residency**: Clerk and Auth0
have no UAE region, so either would move identity PII out of the country and falsify the
hosting claim. **Cost**: at ~5,300 users growing to 50,000, per-MAU pricing is a real
line item where self-hosting is flat. A third reason is modelling: academy-scoped roles
(`user_academy_roles`) map cleanly onto our own schema, where a generic IdP's
organisation model would need bending.

**The library is [better-auth](https://www.better-auth.com).** "A maintained library"
is not an answer a reviewer can check, so it is named. What it brings, and what was
confirmed rather than assumed:

- **It is alive.** Checked on 22 November 2026: the 1.7 line is current on npm, released
  within days of the check, with a 1.8 beta in progress. The check was not a
  formality. **Lucia**, the library this paragraph would have named two years ago, was
  deprecated as a library by its author in 2025 and now exists as a guide to writing
  sessions yourself. A dead dependency in a technology proposal is worse than no name.
- **Its tables live in our Postgres**, created by our own hand-written migrations like
  every other table (`0003_auth.sql`). It is handed a `pg` pool and uses its built-in
  query layer, **not its Drizzle adapter**: the adapter needs a newer `drizzle-orm`
  than the API runs, and the auth tables are deliberately kept out of the schema the
  application's queries are built from. Sessions are database rows, not self-contained
  JWTs, so a session can be revoked and "sign out everywhere" is a `DELETE`.
- **Password hashing is scrypt by default**, not argon2id. Both are memory-hard and
  acceptable; argon2id is the current OWASP first choice and is available by supplying
  the library's hash and verify functions. An earlier draft of this proposal said
  "argon2id" as if it came in the box. It does not, and the configuration is one more
  thing we own.
- **TOTP** is a first-party plugin (with backup codes), enabled when a requirement asks.

**The trade-off, stated.** better-auth reached 1.0 in late 2024. It is young, it
releases often, and its minor versions remove things (the 1.7 notes deprecate an
endpoint for removal in the next minor). So: the version is pinned exactly, upgrades
are a reviewed change with the changelog read, and the risk of a breaking or abandoned
release is ours. The exit is bounded because the data is ours: users, credentials and
sessions sit in tables we migrate, so replacing the library is a code change, not a
data migration out of someone else's service.

**What is deliberately not built:** SSO, social login and SCIM, because no requirement
asks for them.

**Integrated**, pinned at 1.7.27
([ADR 0006](./adr/0006-cookie-sessions-and-the-auth-role.md)). A person signs in at
`/api/auth/sign-in/email` and receives an httpOnly, SameSite=Lax cookie naming a
session row; the HMAC bearer token the slice used before is gone. The open question
this section used to end on is settled the stricter way: `athlete_app` still holds
nothing on `users` ([ADR 0004](./adr/0004-privilege-matrix-and-voiding.md)), and
better-auth connects as a second role, `athlete_auth`, which holds identity and
sessions and nothing tenant-owned. Three things it does not do by itself are ours: the
academy a session acts in is a column only the server writes, roles are read from the
database on every request rather than kept in the session, and state-changing requests
to our own routes are origin-checked.

Two facts about the library that the integration turned up, recorded because both are
the kind a proposal gets wrong by assuming. **It is ESM-only** and this API compiles to
CommonJS; it is loaded with a dynamic `import()`, which works in the built image, the
dev runner and Vitest, and the API's module format did not have to change. **It
switches its origin check off when it detects a test environment**, so the
configuration states the check explicitly: otherwise the suite would exercise a more
permissive library than the one deployed.

**What v1 leaves out:** accounts are created by an operator CLI, not by sign-up or
invitation, and there is no password reset by email, no email verification and no
TOTP. Each needs outbound email or a requirement that does not exist yet.

**AWS Cognito** — would keep residency if available in-region, but has poor developer
experience and hard-couples to AWS. **Keycloak** — full OIDC in-country, but an entire
JVM service for a small team to patch and back up, with no federation requirement to
justify it.

## 8. Hosting — Azure UAE North + UAE Central

A region-availability decision, not a product preference. See
[05-deployment.md](./05-deployment.md) for the full reasoning, including the March 2026
AWS `me-central-1` impairment and why Google Cloud cannot satisfy the residency
requirement at all.

## 9. Observability — OpenTelemetry → Application Insights

Vendor-neutral instrumentation so the exporter is swappable, consistent with keeping the
deployment portable. **Sentry was considered and dropped**: it would place error payloads
containing athlete names and coach notes outside the UAE, which would contradict the
residency argument used to reject Clerk and Auth0. Holding one rule — *no personal data
leaves the UAE in readable form* — is worth more than better exception triage.

**Self-hosted Grafana/Prometheus/Loki** — rejected: an entire second system for a small
team to run, and if it shares a region with the app it dies in the same event.

## 10. Tooling defaults, named

Three places where the framework's default tool was not used. Each is a default, so
each needs the same treatment as the larger choices: the alternative named, and the
ground stated.

### Validation — Zod, not class-validator + class-transformer

Nest's documentation validates with decorated DTO classes. They are rejected here on
four grounds, in order of how checkable they are.

1. **CI forbids the shape they require.** A PATCH body is "the create shape, every
   field optional". With class DTOs that is `PartialType(CreateAthleteDto)`, and
   `PartialType` comes from `@nestjs/mapped-types`. `packages/contracts` is shared with
   the browser, and the `contracts-stay-pure` boundary rule fails the build on any
   `packages/contracts → @nestjs/*` import. So with class DTOs every patch shape either
   breaks that rule or is written out a second time by hand. With Zod it is
   `patchOf(schema)`: derived, in the shared package, with no framework import.
2. **No inference.** A decorated class is a type and a set of rules that agree only
   because someone kept them in step: `@IsString()` on a property typed `number`
   compiles. A Zod schema is the rule, and `z.infer` is the type.
3. **A runtime requirement the rest of the stack does not have.** class-validator needs
   `class-transformer` to turn a plain body into a class instance, plus
   `reflect-metadata` and `emitDecoratorMetadata`. Nest's own dependency injection
   already needs the last two in `apps/api`; the shared package and the SPA do not, and
   would acquire them.
4. **Sharing does not work in either direction.** Import the DTO classes into the SPA
   at runtime and the decorators and their metadata runtime ship to the browser. Import
   them as types only and nothing is validated on the client at all.

What is **not** claimed: that class-validator cannot express refinements, unions or
cross-field rules. It can, through custom constraint classes. The argument is about
where the definition lives and what it drags with it, not about expressiveness.

**Trade-off accepted.** Nest's built-in `ValidationPipe` and the Swagger plugin's DTO
introspection are given up. Validation is instead a declared route property
(`@Validate`) read by one global interceptor, which fails closed when a route forgets
it ([02](./02-architecture.md#cross-cutting-concerns-and-where-each-one-lives)), and
the OpenAPI document is generated from the same Zod schemas and the routes' own
declarations (`apps/api/src/openapi/`), committed as `apps/api/openapi.json` and checked
for drift by a test.

### Test runner — Vitest, not Jest

Nest's CLI scaffolds Jest. Vitest was chosen because it runs TypeScript and ES modules
without a transform layer to configure (`ts-jest` or Babel, each with its own module
settings to keep in step with `tsconfig`), and because a sub-second unit run is what
makes "run the tests" a habit rather than a step.

**The cost is real and was paid.** Vitest compiles with esbuild, which does not emit
decorator metadata, so Nest's injector cannot construct this application's real
controllers under test. Two consequences are visible in the suite: the HTTP-level
validation spec runs against a fixture controller whose providers are built by
factory, and
the real routes are held to their declarations by a static walk of the module graph
(`authz.route-coverage`) plus the smoke script over the running container. If a test
ever needs the real application booted in-process, the route is an SWC transform for
Vitest. Jest with `ts-jest` would not have had this problem. It was judged a fair
price, and it is written here because it is the first thing a Nest developer will trip
on.

### Lint — typescript-eslint with type information, not a syntax-only linter

The gate exists for one rule. An authorization assertion that returns a promise and has
lost its `await` type-checks, returns 200, and skips the check. This was demonstrated,
not supposed: removing the `await` passed `typecheck` and failed `lint`. Only
`no-floating-promises` catches it, and that rule needs the TypeScript checker's types.
So ESLint runs with `projectService` on, and `no-floating-promises`,
`no-misused-promises` and `require-await` are errors
([`tooling/eslint-config`](../tooling/eslint-config/README.md)).

Faster linters were the alternative: **Biome** and **oxlint** are both far quicker.
They were not chosen because the one rule that matters has to agree with the compiler
about what is a promise, and at the time of writing neither runs on the TypeScript
checker itself. The price is a lint pass that costs about as much as a type-check. It
is cached by Turborepo and runs pre-commit on staged packages only.

There is **no formatter** in the repository. Prettier is the default companion and
adding it is a repo-wide diff that proves nothing in a proposal; a team adopting this
would add one on day one.
