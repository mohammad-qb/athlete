# 3. Flat rule conditions; coach scope resolved once per request

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

A coach may see the athletes on the teams they are assigned to *now*. Written as a
rule, the natural form traverses relations: athlete → membership → team → assignment →
user, with two period tests on the way.

[ADR 0002](./0002-casl-over-a-static-permission-map.md) has a rule evaluated two ways:
in memory by CASL's matcher, and as SQL by our compiler. A nested condition is where
those two can disagree. In the adapter we studied, a relation-nested condition falls
through to an equality test in memory and is therefore **denied** by `can()`, while
the SQL path enforces it; its own comments admit that one kind of shared read exists
only through SQL, guarded by nothing but that comment.

## Decision

> **A rule condition may name only columns of the subject's own table. A coach's scope
> is resolved once per request, at one instant, into id lists on the principal, and
> rules are written over those lists.**

- `SubjectRows` in `ability.ts` lists, per subject, the fields a rule may condition
  on. A condition on any other field does not compile, and each repository's column
  map is tied to it, so a rule on a new field does not compile until its column is
  mapped.
- The tenant interceptor resolves `activeTeamIds` and `visibleAthleteIds` inside the
  tenant transaction: one query for assignments, one for memberships, both skipped for
  non-coaches. Rules then read `{ teamId: { $in: activeTeamIds } }`.
- **`asOf` is the database's clock** — the transaction's `now()`, read in the same
  statement that sets the tenant key — not the host's. The periods were written
  against that clock.
- **An empty set emits no rule.** A coach with no active assignment gets a 403 that
  says why, not a filter over an empty list and an inexplicably empty page.
- **Instance checks need every conditioned field.** CASL treats a *missing* field
  differently from a null one, so a partially selected row can pass where the full row
  would not. The types require the fields; do not cast around them.
- **A historical roster is filtered by membership scope only.** `?at=` chooses which
  period to show; authorization is the caller's team scope today. Filtering the
  athlete join by today's scope would drop everyone who has since left.

## Options considered

- **Nested conditions compiled to joins or `EXISTS`** — expressive, and exactly the
  SQL-versus-memory asymmetry described above unless a second, relation-aware matcher
  is also written and kept in step.
- **SQL only, no in-memory check** — removes the asymmetry by removing a direction.
  Rejected: `create` has no existing row for a filter to exclude, and a 403 for a named
  scope key needs an answer before any read.
- **Resolve scope lazily, per query** — saves the two queries on requests that do not
  need them, at the price of rules evaluated at different instants within one request.

## Consequences

- **Good:** the in-memory answer and the SQL filter are the same rule over the same
  literal ids; "as of when?" has exactly one answer per request; the closed-assignment
  case is tested by resolving the same coach's scope at two instants over unchanged
  data.
- **Cost — the scale ceiling.** Scope is an `IN` list. At 15–30 academies that is tens of
  team ids and at most a few hundred athlete ids per coach, bound as parameters. It stops being
  reasonable when one principal's scope reaches thousands of ids, such as a
  federation-wide coaching role.
- **Exit route:** a relation filter in the query, under Drizzle's relational query API
  v2, with a matcher taught to agree with it. Not a nested condition today.
- **Cost:** an assignment that closes mid-request is honoured until the request ends.
- **Asserted by:** `authz.principal-scope.integration`,
  `authz.resource-scoping.integration`, and the null-agreement cases in
  `authz.to-sql-where.unit`.
