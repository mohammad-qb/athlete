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
| Auth | **Self-hosted auth library, own Postgres** | Identity PII stays in the UAE; flat cost |
| Hosting | **Azure UAE North + UAE Central** | Only provider with in-country primary *and* in-country DR |
| IaC | **Terraform** | Keeps the portability claim credible |
| Observability | **OpenTelemetry → Application Insights** | Telemetry stays in-region; vendor-neutral instrumentation |

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

## 7. Authentication — self-hosted library, users in our own Postgres

**Why.** Two hard constraints decide this. **Residency**: Clerk and Auth0 have no UAE
region, so either would move identity PII out of the country and falsify the hosting
claim. **Cost**: at ~5,300 users growing to 50,000, per-MAU pricing is a real line item
where self-hosting is flat. A third reason is modelling: academy-scoped roles
(`user_academy_roles`) map cleanly onto our own schema, where a generic IdP's
organisation model would need bending.

**The objection, answered directly:** this is not hand-rolled authentication. A
maintained library handles argon2id hashing, session rotation and TOTP. What is
deliberately *not* built: SSO, social login and SCIM — because no requirement asks for
them.

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
