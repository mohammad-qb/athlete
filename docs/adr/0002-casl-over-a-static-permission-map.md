# 2. CASL as the single authorization policy, over a static permission map

- **Status:** Accepted. **Reverses** an earlier decision, recorded below.
- **Date:** 2026-11-22

## Context

The slice authorized in two unconnected places. Routes carried `@Authorize({ roles })`
and a guard intersected role lists. Resource rules — which athletes may *this* coach
see — lived in a `PolicyService` that services had to remember to `await`.

Both halves failed in ways that were found, not imagined:

- `GET /athletes`, `GET /teams/:id/roster` and `POST /sessions` had the role check and
  **no** resource check. Any coach could read every athlete in the academy and any
  team's roster at any date, including a coach whose assignment had closed — the exact
  case the proposal uses to justify temporal assignments.
- A dropped `await` on a policy assertion type-checked, returned 200 and skipped the
  check. No test could observe it.

An earlier session had considered a permission library and **rejected CASL**,
specifying instead a static `Permission` union and a frozen role→permission map in the
shared contracts package. The ground was: "`@casl/prisma` exists, there is no Drizzle
equivalent" — so CASL's conditions could not become query filters, and without that a
library only restates the role check.

## Decision

> **Adopt CASL. One function, `defineAbility`, is the whole authorization policy. The
> route guard asks it coarsely; repositories filter with it; services instance-check
> against it. The static permission map is not built.**

- **The rejection's ground was answered by evidence.** A sibling production project
  had written a CASL→Drizzle adapter. The missing piece exists and is small.
- **What is hand-written is only the SQL direction.** CASL's native condition dialect
  is evaluated in memory by CASL's own matcher. `toSqlWhere` compiles one condition to
  a Drizzle predicate; `accessibleBy` merges a principal's rules using CASL's
  `rulesToCondition`, so SQL inherits the matcher's priority semantics instead of
  restating them. About 300 lines including comments. One dependency: `@casl/ability`.
- **Two modes from one definition.** *Coarse* (no conditions) in the guard: "may this
  role ever do this?". *Scoped* (conditions over the principal's resolved scope) inside
  the tenant transaction: "to which rows?". Nest runs guards before interceptors, so
  the guard cannot have the scope — and should not, because a conditional `can` answers
  true to a type-level check, which is how a scoped customer grant opens a back-office
  route when one ability serves both jobs. A test asserts the modes agree on which
  operations exist.
- **Deny by default, at every level.** A route with neither `@Permission` nor
  `@Public` is refused. No rule for an action is a `FORBIDDEN`, never an unfiltered
  query. An operator or field the compiler does not know throws.
- **Enforced by construction.** Repository reads and the versioned update take a
  required access parameter; a read without it does not compile. The instance check is
  synchronous, so there is no `await` to drop.
- **Action and subject names live in the shared contracts package** (plain strings);
  the ability and the compiler do not, because that package must not import server
  dependencies.

## Options considered

- **The static permission map** (the earlier decision) — a typed union and a frozen
  map answer "may this role do X" well. They do not answer "to which rows", which is
  where the live defect was; that would have stayed hand-written per query, next to
  the map, free to drift from it.
- **Copying the sibling project's adapter** — rejected. It targets Drizzle's
  relational query filters and recovers their type from the live client, which needs
  `drizzle-orm@1.0.0-rc` and a relations graph. This repository is on 0.44, uses the
  core query builder only, and has no relations file. Moving to a release candidate
  for relation filters the design does not use is indefensible in a proposal that
  argues for boring technology.
- **Everything in RLS** — leak-proof, but hard to unit-test, hard to evolve, and it
  turns a 403 into an empty result. RLS stays the tenant boundary and nothing more.
- **Keep `PolicyService`, add the missing calls** — fixes today's three routes and
  leaves the mechanism that let them be forgotten.

## Consequences

- **Good:** one place to read the policy; the resource-scoping defect is closed and a
  mutation check (deleting each of the eight places a repository applies its
  predicate) fails the suite every time; one boundary-rule exception was removed.
- **Behaviour changes it caused:** `platform_admin` is now admitted (no route listed
  that role before); a coach reaching for another team's *session* gets 404 where the
  old check gave 403, because the row is no longer loaded unfiltered; a coach whose
  team has no athletes gets 403 on the athlete list rather than an empty page.
- **Cost:** conditions must stay flat ([ADR 0003](./0003-flat-conditions-and-resolved-scope.md)).
  `moduleResolution` moved to `node16` because CASL 7 publishes its types only through
  the package `exports` map.
- **Left open:** whether a coach should *update* athlete records is a product
  question. The grant exists because the old role list allowed it and this change was
  meant to preserve behaviour.
- **Asserted by:** `authz.ability.unit`, `authz.guard.unit`, `authz.to-sql-where.unit`,
  `authz.accessible-by.unit`, `authz.route-coverage`,
  `authz.resource-scoping.integration`.
