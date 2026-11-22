# Backend foundations: authorization, errors, validation, privileges

**Goal.** When this plan is done, `apps/api` has four load-bearing subsystems that are
enforced rather than documented: a CASL ability as the single authorization policy (coarse
check in the guard, row filters in repositories), a first-class `ApiError` taxonomy with one
terminal error responder, validation that is on by default and fails closed when a route
forgets to declare it, and a database privilege matrix in which `athlete_app` cannot delete a
recorded fact or mint a role grant. Supporting that: a type-aware ESLint gate, a restructured
Terraform layout whose deploy identity cannot touch IAM, and docs that argue the choices
honestly — including the ones this plan reverses.

**Non-goals.** No new product surface: no coaches/assessments/scheduling API, no web UI, no
credential storage or session management (token *verification* only, as today), no offline
sync client, no OpenAPI client generation beyond the document itself, and no move off
`drizzle-orm@0.44.x`.

## Progress tracker

| Phase | Name | Status |
|---|---|---|
| 1 | Repo guardrails + error contract | done |
| 2 | Authorization model (CASL + SQL compiler) | not started |
| 3 | Enforce scoping (the live hole) | not started |
| 4 | Database privileges + fact immutability | not started |
| 5 | Validation on by default | not started |
| 6 | Terraform restructure + secrets | not started |
| 7 | Docs, ADRs, verified state | not started |

**Current phase:** 1 — done.
**Recommended next phase:** 2.

Phase 6 touches no application code and may run in parallel with 2–5 if two sessions are
available; every other phase depends on the one before it.

**At the end of your run, update this tracker.** Set the phase you worked to `done`,
`in progress` or `blocked`, move the two lines above, and add any deviation from the plan as a
one-line bullet under that phase's "Deviations" heading. If you created one, say so.

## Standing execution rule

At the start of each phase, verify this plan against the live repo and against earlier phases'
recorded deviations — file paths, exported names and versions may have moved. Do not reopen
settled decisions below without new evidence. If an assumption turns out to be wrong, update
this document, record the deviation, and surface it in your final message rather than silently
changing direction.

## Decisions & context

### What this repository is

A technical proposal. `docs/` holds the written argument (sections A–E of a brief); the code is
*evidence* for it, and each hard claim is asserted by a test. That matters for every phase:
changing behaviour means changing the prose and the verbatim verified-state block in
[`README.md`](../../README.md) that quotes exact test counts and smoke output. A claim in the
README that no longer reproduces is worse than no claim.

### The one decision this plan reverses

An earlier session rejected CASL and specified a static `Permission` union plus a frozen
`ROLE_PERMISSIONS` map in `packages/contracts`. **That is reversed: CASL is adopted.** The
ground given for the rejection — "`@casl/prisma` exists, no Drizzle equivalent" — was answered
by a sibling production repo (`../askedgar`) that wrote one. Do not rebuild the static
permission map; if you find references to it, they are stale.

What carries over unchanged from that session: deny-by-default in the guard, the route-coverage
test, the committed route manifest, Zod kept over class-validator, `better-auth` named in
docs/01 §7, type-aware ESLint, and the two-passes-become-phases verification discipline.

### Why askedgar's adapter is *not* copied

`../askedgar/packages/api/services/iam/src/drizzle-casl/` compiles CASL conditions into Drizzle
RQB **v2** filter objects, recovering the exact filter type from the live client
(`DrizzleWhere<Query,'users'>`). That requires `drizzle-orm@1.0.0-rc.3` and a `defineRelations`
graph. This repo is on **`drizzle-orm@0.44.7`**, where RQB `where` is a callback and no object
filter type exists; `apps/api` uses the core query builder exclusively and has no relations
file. Upgrading to a release candidate to gain relation filters this design does not use would
be indefensible in a proposal that argues for boring technology.

Instead: **CASL with its native Mongo-style condition dialect, plus a small
condition→`SQL` compiler for the core query builder.** CASL's default matcher then evaluates
conditions in memory for free (`ability.can(action, subject(...))`), and only the SQL direction
is hand-written. Dependency added: `@casl/ability` only.

### Conditions stay flat — and what that costs

askedgar's parser falls through to `eq` on relation-nested conditions, so an in-memory `can()`
**denies** them; their own `grantDatasetAccess` comment admits shared-dataset reads therefore
exist only through the SQL path, enforced by nothing but that comment. This plan avoids the
asymmetry by keeping every condition flat — columns of the subject's own table only.

The consequence is load-bearing, so do not redesign around it: a coach's scope is resolved
**once per request** into id sets on the principal (`activeTeamIds`, `visibleAthleteIds`,
`asOf`), and rules read `{ teamId: { $in: activeTeamIds } }` rather than traversing
membership → team → assignment. At this scale (15–30 academies, hundreds of athletes) that is
one extra query and an `IN` list of tens of ids. The exit route, when it is ever needed, is a
relation filter under RQB v2 — not a nested condition today.

A coach with **no** active assignment gets no rule emitted at all, so `accessibleBy` throws
`FORBIDDEN`. That is deliberate: docs/02 argues for "a real 403 rather than an inexplicably
empty result set", and an empty `$in` list would produce the empty set it warns about.

### Coarse vs scoped ability (the Nest ordering constraint)

Nest runs guards **before** interceptors, and the coach scope sets require a query inside the
tenant transaction that `TenantTransactionInterceptor` opens. So the ability is built in two
modes from **one** definition:

- `defineAbility(principal, { scoped: false })` — in the guard. Rules are emitted without
  conditions. `can(action, subject)` answers "may this role ever do this", which is exactly
  what a route-level gate should ask.
- `defineAbility(principal, { scoped: true })` — inside the tenant transaction, published on the
  request context. Rules carry conditions; repositories filter with them; services may
  instance-check a loaded row.

A test asserts the two modes agree on which `(action, subject)` pairs exist, so the guard can
never admit a subject the scoped layer would refuse outright. This is deliberately *not*
askedgar's arrangement, where one conditional ability serves both and a customer's conditional
`read` grant satisfies a backoffice `read` gate — the bug their separate `administer` action
exists to dodge.

### Tenancy stays in the database

RLS is the tenant boundary and keeps its current scope: `academy_id = app_current_academy()`,
nothing about roles. Ability conditions therefore carry **no `academyId` clause** — it would be
redundant with RLS and with the repositories' existing defence-in-depth predicates. askedgar
has no RLS at all, which is why its conditions must carry `organizationId` everywhere; do not
import that habit.

### Boundary rules this plan must respect

- [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs) `contracts-stay-pure` errors on any
  `packages/contracts` → `@nestjs/*`, `drizzle-orm` or `pg` import. Action and subject **names**
  may live in contracts (plain strings, shared with the SPA); the ability definition and the SQL
  compiler may not.
- `no-sql-outside-repositories` targets `apps/api/src/db/schema.ts` only. The condition→SQL
  compiler takes a column map as a parameter and imports nothing from the schema, so it needs
  **no** exception — and retiring `policy.service.ts` in phase 3 *removes* one. The exception
  list should get shorter, not longer.

### Files that matter

| Path | Why |
|---|---|
| `apps/api/src/common/authz/` | guard, decorator, `policy.service.ts` (retired in phase 3) |
| `apps/api/src/common/tenancy/request-context.ts` | `Principal` + ALS; gains scope sets and the scoped ability |
| `apps/api/src/common/tenancy/tenant-transaction.interceptor.ts` | where the scoped ability is built |
| `apps/api/src/modules/*/\*.repository.ts` | the only SQL; gains a required ability-filter parameter |
| `apps/api/drizzle/0000_init.sql`, `0001_rls.sql` | existing schema and RLS; **never edited** — migrations are forward-only |
| `apps/api/test/support/harness.ts` | already exports `createTeam`, `createAthlete`, `addMembership`, `assignCoach` — the two-team fixture is cheap |
| `scripts/smoke.sh` | asserts error bodies over HTTP; changes whenever the error contract does |
| `README.md` | verbatim verified-state block and smoke transcript |
| `../askedgar` | reference implementation only. Read, don't copy. |

### Known live defects this plan closes

1. `GET /athletes`, `GET /teams/:id/roster` and `POST /sessions` run **no** resource check, so
   any coach reads every athlete and every team's roster at any date — including a coach whose
   assignment has closed, which is the exact case docs/02 uses to justify the design. Phase 3.
2. `grant select, insert, update, delete on all tables` plus blanket `alter default privileges`:
   one DB role with full DML everywhere, including `DELETE` on recorded facts and writes to
   `user_academy_roles`. Phase 4.
3. `session_participants → training_sessions` and `team_memberships → teams` are
   `ON DELETE CASCADE`, so deleting a parent empties a register the README claims is protected.
   Phase 4.
4. `PATCH /athletes/:id` with a misspelled field validates to `{}` and returns **200 with a
   bumped ETag having changed nothing**, invalidating every other client's ETag. Phase 5.
5. A dropped `await` on a policy assertion silently skips authorization; no test would catch it.
   Phase 1 (`no-floating-promises`) — **closed**.
6. `GET /teams/:id/roster?at=<garbage>` builds `new Date('garbage')` and hands an Invalid
   Date to the driver, so an unvalidated query parameter produces a **500**. Found while
   verifying phase 1's catch-all filter. The redaction holds (the client learns nothing,
   the log carries the SQL), but a client error is being reported as a server fault.
   Phase 5 — it is the query-schema half of defect 4, and `@Validate({ query })` closes it.

---

## Phase 1 — Repo guardrails + error contract

**Goal.** The repository has version control, a type-aware lint gate that makes a dropped
`await` a build failure, and one error taxonomy that every failure path flows through — so every
later phase lands on a repo where authorization mistakes and unclassified failures are loud.

**What to build.**

- `git init`, then one baseline commit of the current tree before any edit. `.gitignore` already
  exists. This is first so phases are revertible.
- `tooling/eslint-config/` as a workspace package (mirroring `../askedgar/tooling/eslint-config`
  in shape, not content): flat config, `typescript-eslint` with `projectService` enabled, and
  `no-floating-promises`, `no-misused-promises`, `require-await` as **errors**. Root
  `eslint.config.mjs` consumes it; `package.json` gains `"lint": "turbo run lint"` and each
  package a `lint` script. Fix every violation the rules surface.
- `lefthook.yml` (pre-commit: lint + typecheck on staged packages) and `commitlint.config.mjs`.
- `apps/api/src/common/errors/` — the taxonomy, adapted from
  `../askedgar/packages/api/services/exceptions` and `exception-filters`:
  - `api.error.ts` — `ApiError` with `type`, `statusCode`, `code?`, `meta?`, `cause?`,
    `explanation?`, `logLevel`, and `toJSON()` that **omits `cause`**. `ApiErrorType` covers
    `VALIDATION | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | RATE_LIMIT | BAD_REQUEST |
    INTERNAL | DATABASE | TIMEOUT | UNKNOWN`. **`UNKNOWN` maps to 500, not 400** — askedgar maps
    it to 400, which reports an unclassified server fault as the client's mistake and, because
    `logLevel` derives from status, keeps it out of error-level alerting entirely.
  - `error-responder.ts` — the single terminal step: log once at `logLevel` with
    `event: 'http.request.failed'`, include `meta` in the log **only for 5xx** (4xx meta echoes
    client input), `response.end()` when `headersSent`, else `status().json(toJSON())`.
  - `filters/api-error.filter.ts`, `filters/http-exception.filter.ts`,
    `filters/all-exceptions.filter.ts` — the catch-all duck-types `http-errors` (body-parser's
    413 keeps its status), honours `expose` for 4xx only, and redacts everything else to
    "Internal server error" with the real error surviving as `cause` in the log.
  - Registered in `app.module.ts` as `APP_FILTER` providers, most specific last.
- Fold the existing `staleWrite()` helper into `ApiError` as `CONFLICT` with
  `meta: { expectedVersion }`, keeping the recovery sentence in `explanation`.
- Update `scripts/smoke.sh` and the README's verbatim transcript to the new bodies.

**Tasks.**

- [x] `git init` + baseline commit before edits — already present (`47f8b9c`), see Deviations
- [x] `tooling/eslint-config` package, root config, per-package `lint` scripts, violations fixed
- [x] lefthook + commitlint
- [x] `ApiError` + `ApiErrorType` + unit tests for the status/logLevel/`toJSON` contract
- [x] `ErrorResponder` + three filters + unit tests for redaction and `headersSent`
- [x] `staleWrite` → `CONFLICT`; smoke script and README transcript updated
- [x] CI: a lint job beside `lint:boundaries`

**Exit criteria.**

```bash
pnpm install
pnpm --filter @athlete/config --filter @athlete/contracts run build
pnpm run typecheck            # clean
pnpm run lint                 # clean, type-aware rules as errors
pnpm run lint:boundaries      # no violations
pnpm --filter @athlete/api run test
pnpm --filter @athlete/api run test:integration
docker compose up -d --build && docker compose run --rm migrate && ./scripts/smoke.sh
```

- `pnpm run lint` fails on a deliberately added unawaited `assertCanAccessAthlete(...)` (verify,
  then revert).
- A thrown bare `Error` returns 500 with body `"Internal server error"` and the original message
  appears only in the log.
- `smoke.sh` passes with the new 409 and 400 bodies; the README block matches reality.

**Verified on 2026-11-22** (macOS, Node 24.14.1, pnpm 11.21.0, Docker 28.3.2,
`postgres:17-alpine`): typecheck 5 tasks clean; `lint` 6 tasks clean; `lint:boundaries`
no violations (50 modules, 98 dependencies); unit 52 passed (4 files); integration 17
passed (4 files); `docker compose run --rm migrate` → `Applied: 0000_init.sql,
0001_rls.sql`; `smoke.sh` 16/16.

Both negative checks were run rather than assumed. Removing the `await` from
`assertCanAccessAthlete` in `AthletesService.update` fails `pnpm run lint`
(`no-floating-promises`) and **passes `pnpm run typecheck`** — which is the entire
argument for the type-aware tier, now demonstrated rather than claimed. A real
unclassified failure (defect 6 below) returned
`{"statusCode":500,"message":"Internal server error","type":"INTERNAL"}` while the log
line carried the full failing SQL, its bound parameters and the tenant id.

### Deviations

- **`git init` was already done.** The repo was on branch `dev` at `47f8b9c`
  ("chore: baseline — athlete platform technical proposal") with a clean tree, so the
  baseline commit this phase asked for already existed. No second baseline was created.
- **Each package carries its own `eslint.config.mjs`.** The plan said "root
  `eslint.config.mjs` consumes it". With `projectService`, `tsconfigRootDir` must point
  at the package that owns the tsconfig, so a single root config would have to
  re-declare per-directory blocks and would silently resolve the wrong project as
  packages are added. The root config now covers root-level JS only, and
  `pnpm run lint` is `turbo run lint && eslint --max-warnings 0 .` so both passes run.
- **`require-await` surfaced nothing.** typescript-eslint's version of the rule permits
  an `async` function that returns a thenable, so the repository methods that `return
  tx.select()...` without awaiting are not violations. Repo-wide the three rules found
  exactly two real defects, both fixed: an unused `userId` destructured in
  `policy.service.ts`, and an unnecessary type assertion in the route-coverage spec.
- **`parseIfMatch` was converted to `ApiError` too.** The plan named only `staleWrite`.
  Leaving its sibling in the same file throwing `BadRequestException` would have left
  one file speaking two error dialects. Both now carry a `code`
  (`if_match_required`, `if_match_malformed`, `stale_write`).
- **`ZodValidationPipe` gained an explicit `message`.** Nest degrades an exception
  payload without one to the class name spelled out, so the new contract was publishing
  `"message": "Bad Request Exception"` for every validation failure. One line, and
  phase 5 replaces the pipe outright — but the body should say something true until then.
- **`ErrorResponder` logs through Nest's `Logger`, not pino + Sentry.** The reference
  implementation injects a pino logger and captures 5xx in Sentry. Neither exists here
  and adding them is not this phase. The responder emits one line per failure with the
  structured fields appended as JSON, which keeps the `event: 'http.request.failed'`
  contract greppable; swapping in a structured logger later touches one method.
- **No prettier.** The reference config layers `eslint-config-prettier`. This repo has
  no formatter, and introducing one would be a repo-wide diff the plan did not ask for.
- **Fixed a pre-existing smoke bug.** `check "read returns an ETag" 0 "$ETAG"` asserted
  the first read returns version **0**, which only holds against a virgin volume; the
  second run of the script failed. It now asserts the shape (`integer`), so the check
  tests the behaviour rather than the fixture. Found by running `smoke.sh` twice.
- **Smoke now asserts bodies, not only statuses.** Four checks read `type` and `code`
  out of the error body, because that is where the contract actually lives. 11 checks
  became 16.
- **Open follow-up, decided deliberately:** every 5xx is redacted to the one blanket
  message, so a `503` says `"Internal server error"` rather than signalling "retry". It
  stays blanket because nothing throws a 5xx `HttpException` today. The first endpoint
  that wants an honest 503 needs a 5xx-safe message allowlist plus `Retry-After`, not a
  loosening of the redaction — the status code carries the retry signal until then.
- **The log walks the whole `cause` chain**, bounded at 5 and cycle-guarded, rather than
  serialising its first step. This was a real loss, not a tidiness point: Drizzle wraps
  every database failure in a `DrizzleQueryError` carrying the SQL and parameters and
  attaches the `pg` error as *its* cause, and `captureStackTrace` means the driver's
  message appears in no stack either. Verified against the live stack — the same request
  that previously logged only `Failed query: select ...` now also logs
  `error: invalid input syntax for type timestamp with time zone`, which is the only
  step that says *why*. At 4xx severities no stack is logged at all, so one step there
  meant no diagnosis whatsoever.
- **`engines.node >= 22.12.0` is advisory, and stays that way — tested, not assumed.**
  pnpm 11.21.0 only *warns* on a root `engines` mismatch and exits 0; `engine-strict=true`
  in `.npmrc` does not change that, because it governs dependencies' engines rather than
  the project's own (verified against a throwaway package declaring `node >=99`). So no
  `.npmrc` was added: it would have been configuration whose comment claimed an
  enforcement it does not perform. CI's `node-version: 22` and the Dockerfile's
  `node:22-alpine` both resolve to the newest 22.x, which cannot be below 22.12.0, and
  `setup-node` has no way to say "latest 22.x, at least 22.12" — a range like `>=22.12`
  would also match Node 24 and silently move CI off the target major. Enforcing the floor
  for real would take a hand-rolled `preinstall` semver guard, which does not pay for
  itself against an 11-patch window of Node 22 that ages out on its own.

---

## Phase 2 — Authorization model (CASL + SQL compiler)

**Goal.** One ability definition is the whole authorization policy. The guard gates routes from
it coarsely; a scoped ability rides the request context ready to filter queries. **No query
filtering changes yet** — rules mirror today's role checks exactly, so the phase is a refactor
with identical behaviour and a green suite. This is the risky phase; it is early on purpose.

**What to build.**

- `packages/contracts/src/authz.ts` — `Action` (`manage | read | create | update | delete`) and
  `Subject` (`athletes | teams | teamMemberships | trainingSessions | sessionParticipants |
  assessments | userAcademyRoles`) as Zod enums plus inferred types. Pure strings; no Nest, no
  Drizzle. Exported from `packages/contracts/src/index.ts`.
- `apps/api/src/common/authz/ability.ts` — `defineAbility(principal, { scoped })` built with
  `AbilityBuilder` from `@casl/ability`, returning `AppAbility`. Grants, each with a comment
  saying *why* (follow `../askedgar/packages/api/services/iam/src/app-ability.ts` for the
  standard of commentary, not for its content):
  - `platform_admin` → `can('manage','all')`, return early.
  - `academy_admin` → `manage` on every subject **except** `userAcademyRoles` (read only — role
    grants are not an API operation in this slice), with **no `academyId` condition**: RLS scopes
    it.
  - `coach` → `read` on `athletes`/`teams`/`teamMemberships`/`trainingSessions`,
    `create`/`update` on `sessionParticipants`, `create` on `trainingSessions`. When
    `scoped: true`, conditions are `{ teamId: { $in: activeTeamIds } }` on team-keyed subjects
    and `{ id: { $in: visibleAthleteIds } }` on `athletes`; **emit no rule at all when the set
    is empty**.
  - `athlete` → nothing in this slice (the athlete↔user link is unmodelled; deny explicitly, as
    `policy.service.ts` does today).
- `apps/api/src/common/authz/to-sql-where.ts` — `toSqlWhere(condition, columns)` →
  `SQL | undefined`. Supports `$eq $ne $gt $gte $lt $lte $in $nin`, `null` handling, and
  `$and/$or/$not`; throws on an unknown operator (fail loud, never silently permissive). Imports
  only `drizzle-orm` operators and takes the column map as a parameter — **no schema import, so
  no dependency-cruiser exception.**
- `apps/api/src/common/authz/accessible-by.ts` — merges rules for `(action, subject)` the way
  askedgar's `accessible-by.ts` does: `can` rules OR'd, `cannot` rules AND'd as negations,
  unconditional collapsing to "no restriction", and **throws `ApiError` `FORBIDDEN` when no rule
  grants the action** rather than returning an unfiltered query.
- `@Permission({ action, subject })` replaces `@Authorize({ roles })` on every route, carrying
  the same effective access. `@Public()` unchanged. Guard builds the coarse ability and checks
  `can(action, subject)`; **a route with neither decorator is still refused** — keep
  deny-by-default, do not copy askedgar's `if (!permission) return true`.
- `request-context.ts` gains `asOf: Date`, `activeTeamIds: string[]`,
  `visibleAthleteIds: string[]` and `ability: AppAbility` (scoped). The tenant interceptor
  resolves the scope sets inside the transaction — one query for teams, one for athlete ids —
  then builds the scoped ability and puts it on the context.
- Extend `apps/api/test/authz.route-coverage.spec.ts`: every route declares `@Permission` or
  `@Public`; every declared `(action, subject)` is in the contracts enums; every enum subject is
  claimed by a route or listed in an explicit `RESERVED_SUBJECTS` array in the test; the
  `@Public` allowlist stays `['HealthController.live']`. Add the coarse/scoped agreement test.
- Emit `docs/reference/route-manifest.md` (route × action × subject) from the same metadata walk
  and fail the test when it drifts.

**Tasks.**

- [ ] `@casl/ability` added; `Action`/`Subject` in contracts
- [ ] `defineAbility` with both modes + unit tests per role
- [ ] `toSqlWhere` + unit tests including the unknown-operator throw
- [ ] `accessibleBy` merge + fail-loud test
- [ ] `@Permission` swapped in across all routes; guard updated; `@Authorize` deleted
- [ ] scope sets + scoped ability on the request context
- [ ] route-coverage test extended both directions; manifest emitted and committed

**Exit criteria.**

Same command block as phase 1, all green, plus:

- Deleting a `@Permission` from any route fails `pnpm --filter @athlete/api run test`.
- Adding `@Permission({ action: 'read', subject: 'athlete' })` (singular typo) fails `typecheck`.
- `docs/reference/route-manifest.md` is committed and matches the walk.
- Behaviour is unchanged: the 17 integration tests and `smoke.sh` pass untouched.

### Deviations
_(none yet)_

---

## Phase 3 — Enforce scoping (the live hole)

**Goal.** Resource authorization is enforced by construction: a repository read cannot be
written without an ability filter, and a coach sees only the athletes and rosters of teams they
currently coach. This closes defect 1.

**What to build.**

- Repository read methods take a **required** filter parameter (`where: SQL | undefined` derived
  from `accessibleBy`), applied with `and(...)` alongside the existing `academy_id` predicate.
  A read written without it does not compile.
- `AthletesService.list()` and `getById()`, `TeamsService.rosterAt()`, and
  `SessionsService.createSession()` go through the scoped ability. `rosterAt`'s `at` parameter
  stays a *query* concern (which period to show); authorization is the team scope.
- `PolicyService` is deleted. `assertCanAccessAthlete`/`assertCanRecordAttendanceForTeam` become
  in-memory instance checks against the scoped ability where a loaded row exists, or the filter
  itself where it does not. Remove its `.dependency-cruiser.cjs` exception and its comment.
- A two-teams-one-academy fixture in `apps/api/test/support/harness.ts` (two teams, two
  athletes, a coach assigned to one team, plus a closed assignment on the other).
- `apps/api/test/authz.resource-scoping.integration.spec.ts` asserting: a coach's `list` returns
  only their teams' athletes; `getById` on another team's athlete is refused; `rosterAt` on an
  unassigned team is refused; a coach whose assignment has **closed** is refused the roster they
  could read last month; an academy admin sees everything in the academy; nothing crosses
  academies.
- Two smoke checks: a coach token listing athletes, and the same coach refused another team's
  roster.

**Tasks.**

- [ ] required filter parameter on repository reads; all call sites updated
- [ ] four endpoints scoped through the ability
- [ ] `PolicyService` deleted; boundary exception removed
- [ ] two-team fixture + resource-scoping integration spec
- [ ] smoke checks added

**Exit criteria.**

Full command block green, plus:

- The new spec fails when any one endpoint's filter is removed.
- `pnpm run lint:boundaries` passes with a **shorter** exception list than before.
- `smoke.sh` reports its new total (update the README block).

### Deviations
_(none yet)_

---

## Phase 4 — Database privileges + fact immutability

**Goal.** The database refuses what the application layer should never ask for: no `DELETE` on a
recorded fact, no write to `user_academy_roles`, no privilege on a future table by default, and
no indirect deletion through a cascading parent. Closes defects 2 and 3.

**What to build.**

- `apps/api/drizzle/0002_grants.sql` — forward-only; **do not edit `0000` or `0001`**:
  - `revoke all on all tables in schema public from athlete_app`, then explicit per-table
    grants. Recorded facts (`session_participants`, `assessments`, `team_memberships`) get
    `SELECT`, `INSERT`, and **column-level** `UPDATE` on voiding/status columns only.
    `user_academy_roles` gets `SELECT`. Mutable entities keep ordinary DML minus `DELETE` on
    parents of facts.
  - `alter default privileges in schema public revoke all on tables from athlete_app` — the
    blanket default in `0001` otherwise grants full DML on every table a future migration adds.
  - `voided_at timestamptz`, `voided_by uuid` on the three fact tables.
  - `session_participants_once_per_session` **dropped and recreated as a partial unique index**
    `where voided_at is null` — Postgres cannot put a `WHERE` on a unique *constraint*, and the
    existing unconditional one makes a replacement row impossible.
  - `team_memberships_no_overlap_same_team` recreated as
    `exclude using gist (...) where (voided_at is null)` — a voided membership must not keep
    occupying its period.
  - `session_participants_session_fk` and `team_memberships`' team FK flipped from
    `ON DELETE CASCADE` to `RESTRICT`.
  - `session_participants_idempotency_uq` on `(academy_id, client_record_id)` stays a full
    constraint — `onConflictDoNothing` targets it and the offline-replay test must not move.
- One shared active-row predicate applied to every fact read — repositories **and** the ability's
  membership conditions. A voided membership must grant nothing.
- `apps/api/src/common/tenancy/database-privileges.ts` — a boot-time assertion run from
  `main.ts` before `listen`: `rolsuper = false`, `rolbypassrls = false`, and
  `has_table_privilege('session_participants','delete') = false`. Refuse to boot otherwise, in
  the same spirit as `loadEnv`. Pointing `DATABASE_URL` at the owner silently voids RLS *and*
  this entire matrix with nothing logged.
- Extend `tenancy.isolation.integration.spec.ts`: `DELETE` on a fact refused; `UPDATE` of a
  non-voiding column refused; deleting a `training_session` that has attendance refused;
  a voided membership grants no access; a newly created table is unreachable without an explicit
  grant.

**Tasks.**

- [ ] `0002_grants.sql` with the full matrix, default-privilege revoke, columns, index surgery, FK flips
- [ ] shared active-row predicate wired through reads and ability conditions
- [ ] boot-time privilege assertion + unit test for the refusal
- [ ] isolation suite extended with the five negative assertions
- [ ] correction path: void + re-insert works end to end

**Exit criteria.**

Full command block green (integration runs against a real Postgres via Testcontainers), plus:

```bash
docker compose run --rm migrate     # Applied: 0000_init.sql, 0001_rls.sql, 0002_grants.sql
```

- The app refuses to boot when `DATABASE_URL` points at the owner role (verify locally).
- Voiding a participation row and inserting its replacement succeeds; the same without the
  partial index would have violated the old constraint.

### Deviations
_(none yet)_

---

## Phase 5 — Validation on by default

**Goal.** A route cannot accept unvalidated input, and a `200` never means "nothing happened".
Closes defect 4.

**What to build.**

- `@Validate({ body?, params?, query? })` route metadata plus a **global interceptor** that
  parses each declared schema and writes results to `request.validated`. An interceptor, not a
  pipe: a Nest pipe receives only `ArgumentMetadata` and cannot read route metadata. The bag
  also sidesteps Express 5, where `req.query` has no setter.
- `@ValidBody()`, `@ValidParams()`, `@ValidQuery()` param decorators that read the bag and
  **throw when their slot is empty** — so a route that forgot `@Validate` fails closed instead of
  receiving raw input.
- `strictObject` helper in `packages/contracts` (unknown keys → 400, matching
  `forbidNonWhitelisted`), applied to every request schema. Patch schemas gain a refinement
  rejecting a body with no recognised field.
- Validation failures become `ApiError` `VALIDATION` with
  `meta.fields: [{ path: 'schedule.timezone', messages: [...] }]` — dot paths, constant top-level
  message so logs pattern-group.
- Route-coverage test: every route taking a body declares a body schema.
- `apps/api/test/validation.http.spec.ts` — a supertest-level spec proving a route *without*
  `@Validate` is refused and that parsed values reach the handler. The manifest proves a
  declaration exists; only this proves validation ran.
- Smoke: `PATCH` with a misspelled field is a 400 and the ETag does **not** move.
- Query parameters are in scope, not just bodies: `?at=<garbage>` on the roster route is
  defect 6 today (a 500 from an Invalid Date reaching the driver). `rosterAt`'s `at` must
  parse through a declared query schema.
- **Carried over from phase 1:** `HttpExceptionFilter.extractMeta()` forwards a 4xx
  exception's whole payload minus Nest's `message`/`error`/`statusCode`, so a guard or
  third-party exception that attaches internal state to a 4xx body publishes it. Left
  open in phase 1 on purpose: a key allowlist would be brittle, it is not a regression
  (Nest's own default filter publishes the same payload), and this phase deletes
  `ZodValidationPipe` and reshapes validation `meta` into `meta.fields` anyway. Decide it
  here, when the 4xx `meta` shape is being defined rather than guessed at.

**Tasks.**

- [ ] `@Validate` + interceptor + bag
- [ ] three fail-closed param decorators; per-parameter pipes removed
- [ ] `strictObject` + non-empty-patch refinement across contracts
- [ ] validation errors folded into the `ApiError` taxonomy
- [ ] body-schema coverage assertion + HTTP-level spec
- [ ] smoke check for the silent-no-op bug

**Exit criteria.**

Full command block green, plus:

- `PATCH /athletes/:id` with `{"dateofBirth":"2010-01-01"}` returns 400 and the ETag is unchanged
  (this is a 200 with a bumped ETag today).
- Removing `@Validate` from a route makes the HTTP spec fail.

### Deviations
_(none yet)_

---

## Phase 6 — Terraform restructure + secrets

**Goal.** The infrastructure expresses the privilege split the README claims: a deploy identity
that can ship a revision and nothing else, with identity, network and database applied by a
human. Touches no application code.

**What to build.**

- Restructure `infra/terraform/` to the layout in `../askedgar/infra/terraform`: reusable
  `modules/{container-app,postgres,static-site,edge}/`, and
  `stacks/{dev,prod}/{base,app}/` plus `stacks/shared/` for the federated CI identity.
  `base` holds identity, network, Postgres, Key Vault — applied manually. `app` holds the
  container revision — applied by CI.
- The deploy identity gets only: push/pull to the registry, create a Container Apps revision,
  read `base` outputs, read/write its own state key. **Not** identity or network write. Mirror
  askedgar's `iam:PassRole` discipline — their CI role scopes it to two exact role ARNs with an
  `iam:PassedToService` condition; the Azure equivalent is a federated credential restricted to
  one repo + environment and a user-assigned identity with role assignments scoped to the app
  resource group only.
- **House rule, documented in `infra/terraform/README.md`:** every wildcard scope carries an
  inline comment naming why, ideally the exact permission error that forced it. Copied straight
  from askedgar, where it is the single cheapest review practice in the repo.
- `dotenvx`-encrypted `.env.development` committed, `.env.keys` gitignored — removes the
  "unit tests need placeholder env values" awkwardness and makes the repo runnable by a reviewer.
- `.tflint.hcl` and a `terraform fmt -check` + `tflint` CI job.
- Keep `infra/terraform/README.md` honest about what remains unapplied: there is still no Azure
  subscription, so this is a reviewed design artifact, not a planned one.

**Tasks.**

- [ ] modules extracted; dev/prod base+app stacks; shared identity stack
- [ ] deploy identity scoped; privilege split documented
- [ ] wildcard-justification rule written down and applied
- [ ] dotenvx env encryption; keys ignored; local-development doc updated
- [ ] tflint + fmt CI job

**Exit criteria.**

```bash
terraform -chdir=infra/terraform/stacks/dev/app fmt -check
terraform -chdir=infra/terraform/stacks/dev/app validate   # init -backend=false
tflint --recursive
pnpm run typecheck && pnpm run lint && pnpm --filter @athlete/api run test
```

- `terraform validate` passes for every stack with `-backend=false`.
- No wildcard scope exists without an adjacent justification comment (grep and eyeball).
- The repo boots from the encrypted env file with `.env.keys` present and fails clearly without it.

### Deviations
_(none yet)_

---

## Phase 7 — Docs, ADRs, verified state

**Goal.** The written proposal argues what the code now does, including the reversal — and every
number in the README reproduces. Last phase by necessity: it describes what exists.

**What to build.**

- `docs/01-technology-stack.md` §10 "Tooling defaults, named": class-validator and
  class-transformer rejected on the four grounds that survive scrutiny — led by the one CI
  enforces (`PartialType` comes from `@nestjs/mapped-types` and `contracts-stay-pure` fails any
  `packages/contracts → @nestjs/*` import, so class DTOs make every patch shape a second
  definition), then no inference, the `class-transformer` + `reflect-metadata` +
  `emitDecoratorMetadata` requirement, and runtime sharing shipping decorators to the browser
  while a type-only import validates nothing. **Do not claim class-validator cannot express
  refinements or unions — it can, via custom constraint classes. That claim is false and the
  document's own standard forbids it.** Also cover Vitest over Jest and the ESLint choice.
- §7 names **better-auth** with the trade-off stated (young library, pinned version, upgrade risk
  owned). **Verify its maintenance status before writing the name** — Lucia was wound down as a
  library, and a dead dependency in a technology proposal is worse than no name.
- `docs/06-decision-summary.md` decision 9 rewritten: CASL is **adopted**, with the real ground —
  a typed condition→SQL layer is ~150 lines over the core query builder, conditions stay flat,
  and the ability replaces both the role check and the hand-written query filters. Record the
  rejected alternative honestly: porting askedgar's RQB v2 adapter would have required
  `drizzle-orm@1.0.0-rc` for relation filters this design does not use.
- `docs/02-architecture.md`: the coarse/scoped ability split, the grant matrix as part of the
  tenancy story, and the limitations list updated (the `IN`-list scale ceiling and its exit
  route).
- `docs/adr/` created with ADRs for the decisions made in phases 1–6: the error taxonomy, CASL
  over a static permission map, flat conditions, the privilege matrix and voiding model, the
  Terraform privilege split. Numbered, dated, following askedgar's ADR shape.
- `README.md`: refresh the verified-state block (test counts, module/dependency counts from
  `lint:boundaries`, smoke total), the verbatim smoke transcript, and the 409 body. Add the new
  tests to "The tests are the argument" table with the claim each one makes falsifiable.
- Move anything lasting out of this plan into those docs, then mark the plan complete at the top
  rather than deleting it — it is the record of why these phases exist.

**Tasks.**

- [ ] docs/01 §10 + §7 (library status verified first)
- [ ] docs/06 decision 9 rewritten; docs/02 updated
- [ ] `docs/adr/` seeded with the phase decisions
- [ ] README verified-state block, transcript and tests table refreshed from a real run
- [ ] plan marked complete; lasting facts relocated

**Exit criteria.**

- A full clean run reproduces every number printed in the README, in order, on one machine.
- No claim in `docs/` describes behaviour the code does not have — specifically: nothing still
  says role logic is deliberately kept out of a permission library, and nothing still says
  recorded facts are protected by `ON DELETE RESTRICT` without naming the parents that cascade.
- `grep -ri "casl" docs/ README.md` shows adoption, not rejection.

### Deviations
_(none yet)_
