# Decision Summary

The five decisions the brief asks for are in the
[README](../README.md#the-five-most-important-technical-decisions) — they belong at the
front, not in an appendix. This document records the next tier of decisions, so the
reasoning is available without re-deriving it.

## Decisions 6–15

| # | Decision | Chosen | Rejected | Trade-off |
|---|---|---|---|---|
| 6 | API style | REST + OpenAPI generated from Zod | tRPC, GraphQL | More boilerplate than tRPC; no flexible querying. Gains a readable contract, native `ETag`/`Idempotency-Key`, free integrations. |
| 7 | Client rendering | Static Vite SPA | Next.js SSR, server-rendered templates | No SSR benefits (none needed). Keeps production at one Node process. |
| 8 | Authentication | better-auth, self-hosted, own Postgres | Clerk, Auth0, Cognito, Keycloak; Lucia (deprecated) | We own password reset, lockout and MFA surface, and the upgrade risk of a young, fast-moving library (version pinned). Keeps identity PII in the UAE and cost flat. |
| 9 | Authorization | **CASL**: one ability definition, asked coarsely by the route guard and compiled to row filters for every repository read | A static role→permission map with hand-written query filters; all in RLS; porting a sibling project's CASL→Drizzle adapter | Conditions must stay flat, so a coach's scope is resolved to id lists once per request (an `IN`-list ceiling). Gains one policy instead of a role check plus per-query filters that can drift apart. See below. |
| 10 | Tenancy model | Shared schema + RLS | Schema-per-tenant, DB-per-tenant | No physical separation; noisy-neighbour risk. Gains one migration run and operational sanity at ~200 tenants. |
| 11 | Concurrency control | Optimistic (`version` + `If-Match`) | Pessimistic locking, last-write-wins | Callers must handle 409. Avoids lock contention across human think-time; prevents silent lost updates. |
| 12 | Error tracking | Application Insights only | Sentry (EU), self-hosted GlitchTip | Weaker triage UX. Keeps "no personal data leaves the UAE in readable form" true with no exceptions. |
| 13 | IaC | Terraform | Bicep, Pulumi, manual | More ceremony than Bicep on an Azure-only deployment. Keeps the portability claim credible. |
| 14 | Monorepo tooling | pnpm workspaces + Turborepo | Nx, Nest monorepo mode, separate repos | No Nx dependency graph or tag-based boundaries. Equivalent guarantee via dependency-cruiser, far less to justify. |
| 15 | Offline support | Designed for, not built | Build offline sync now; ignore it entirely | No offline client today. The write API is already idempotent, so it becomes a feature rather than a rewrite. |

### Decision 9 was reversed, and this is the record of it

An earlier version of this table read *"Roles in guard, responsibilities in services"*
and listed "all in CASL" as rejected. The ground given was that CASL has a Prisma
adapter and no Drizzle equivalent, so its conditions could not become query filters and
a permission library would only restate the role check.

**That ground was wrong, and it was answered by evidence**: a sibling production
project had written the missing piece. So CASL is adopted, on this ground: a typed
condition→SQL layer over Drizzle's core query builder is small — about 300 lines here,
comments included, of which the leaf compiler is the only part that is really ours,
since the rule merge is CASL's own — and with it one ability definition replaces
**both** the role lists on routes **and** the hand-written resource checks. Before,
those were two mechanisms, and three routes had the first without the second: any
coach could list every athlete in the academy and read any team's roster, including a
coach whose assignment had closed. That is the defect a single policy closes by
construction: a repository read does not compile without the filter derived from it.

**The alternative rejected this time**, honestly: porting the sibling project's adapter
as it stands. It compiles conditions into Drizzle's relational query filters, which
would have required `drizzle-orm@1.0.0-rc` and a relations graph, to gain relation
filters this design does not use. Upgrading to a release candidate in a proposal that
argues for boring technology was not defensible. Its adapter also lets a
relation-nested condition be denied in memory while being enforced in SQL; keeping
conditions flat avoids that asymmetry, at the cost stated in the table.

Full reasoning: [ADR 0002](./adr/0002-casl-over-a-static-permission-map.md),
[ADR 0003](./adr/0003-flat-conditions-and-resolved-scope.md), and
[02-architecture.md](./02-architecture.md#authorization-one-policy-asked-two-ways).

## Decisions 16–20: backend foundations

Made while hardening the slice; each has an ADR in [`adr/`](./adr/README.md).

| # | Decision | Chosen | Rejected | Trade-off |
|---|---|---|---|---|
| 16 | Error contract | One `ApiError` taxonomy, one terminal responder; an unclassified error is a 500 | Nest `HttpException`s thrown ad hoc; unclassified → 400 | Every 5xx message is redacted, so an honest 503 needs an allowlist later. Gains one body shape and no leaked internals. |
| 17 | Coach scope | Flat conditions over id lists resolved once per request | Relation-nested conditions; a join per query | An `IN`-list ceiling. Gains SQL and in-memory checks that cannot disagree. |
| 18 | Database privileges | Per-table grant matrix, no `DELETE`, void-and-replace for facts, checked at boot | One role with full DML; soft-delete flags | The matrix is restated in code; corrections are two writes. Gains a database that refuses what the application should never ask. |
| 19 | Validation | Declared per route, on by default, fails closed | Per-parameter pipes; class-validator DTOs | A route that forgets is a 500 until fixed. Gains: a 200 never means "nothing happened". |
| 20 | Terraform layout | `base` applied by humans, `app` by a deploy identity that cannot touch IAM or network | One flat config applied by CI with Contributor | Two applies per deploy and a routine `-target`. Gains a pipeline whose compromise is bounded. |

## Open questions for the client

Listed rather than assumed — each one would change a decision above.

1. **How many academies, and what is the expected tenant growth?** The brief gives
   athletes and coaches but never the tenant count, and it is the number that decides
   shared-schema vs schema-per-tenant. We assumed 15–30 initially, ~200 at the ceiling.
2. **May an athlete hold concurrent memberships in different teams?** We implemented the
   permissive floor (no overlap within the *same* team). A stricter rule is easy to add
   in the service layer; the reverse is a migration.
3. **Is in-UAE residency contractual, regulatory, or a preference?** It determines
   whether the off-provider backup tier needs the client-side-encryption argument or is
   simply permitted.
4. **What are the actual RPO/RTO expectations?** We assumed 15 min / 4 h and justified
   the modesty. If the business needs tighter, the cost changes materially.
5. **Do coaches need to record attendance offline?** We believe yes, from how academies
   actually operate, and designed the API for it — but did not build the client.
6. **Will academies integrate with external systems** (school management, payments,
   wearables)? If yes at launch, it strengthens REST + OpenAPI further and may justify
   webhooks.
7. **Is there an SSO requirement from larger academies?** If yes, the auth decision (8)
   should be revisited toward Keycloak or an enterprise IdP with a UAE presence.
8. **May a coach edit athlete records, or only read them?** The slice lets a coach
   update athletes on their own teams because the first version did; it was preserved,
   not decided.
9. **Is zone-redundant HA worth ~$150–180 a month at launch?** It is the largest single
   line the client can remove, and removing it is the difference between an automatic
   failover and a one-hour restore.

## What we would do first with more time

In priority order, which is itself a statement about what we think matters:

1. **Run the restore drill for real** and record the measured time — converting the RTO
   from an estimate into a number.
2. **Finish the SPA's screens.** The OpenAPI document and the typed client are generated
   from the Zod contracts and kept current by CI, and the SPA's foundation is built on
   them: sign-in, the shell, athletes and teams (including the conflict dialog for a
   refused stale write), and the patterns later screens reuse. Sessions and the
   attendance register are not built yet.
3. **Apply the Terraform to a real subscription.** It is validated and tested against
   a mocked provider and has never been planned against Azure; every permission list
   in it is reasoned, not exercised. Then close the edge gaps it names: managed WAF
   rules and private origins (Front Door Premium, or an origin check), and private
   endpoints for Key Vault, registry and storage.
4. **The backup cron job and absence alerts** (still stubs) and the deploy workflow
   (still prose) — the gap between a designed backup and a working one.
5. **A seeded demo dataset** so the API can be explored without writing SQL.
6. **Load test at 10× concurrency** to replace the arithmetic in
   [04-scalability-reliability.md](./04-scalability-reliability.md) with measurements.
