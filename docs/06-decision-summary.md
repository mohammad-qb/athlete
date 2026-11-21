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
| 8 | Authentication | Self-hosted library, own Postgres | Clerk, Auth0, Cognito, Keycloak | We own password reset, lockout and MFA surface. Keeps identity PII in the UAE and cost flat. |
| 9 | Authorization split | Roles in guard, responsibilities in services | All in RLS; all in CASL | Two places to look. Gains testability and real 403s instead of empty result sets. |
| 10 | Tenancy model | Shared schema + RLS | Schema-per-tenant, DB-per-tenant | No physical separation; noisy-neighbour risk. Gains one migration run and operational sanity at ~200 tenants. |
| 11 | Concurrency control | Optimistic (`version` + `If-Match`) | Pessimistic locking, last-write-wins | Callers must handle 409. Avoids lock contention across human think-time; prevents silent lost updates. |
| 12 | Error tracking | Application Insights only | Sentry (EU), self-hosted GlitchTip | Weaker triage UX. Keeps "no personal data leaves the UAE in readable form" true with no exceptions. |
| 13 | IaC | Terraform | Bicep, Pulumi, manual | More ceremony than Bicep on an Azure-only deployment. Keeps the portability claim credible. |
| 14 | Monorepo tooling | pnpm workspaces + Turborepo | Nx, Nest monorepo mode, separate repos | No Nx dependency graph or tag-based boundaries. Equivalent guarantee via dependency-cruiser, far less to justify. |
| 15 | Offline support | Designed for, not built | Build offline sync now; ignore it entirely | No offline client today. The write API is already idempotent, so it becomes a feature rather than a rewrite. |

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

## What we would do first with more time

In priority order, which is itself a statement about what we think matters:

1. **Run the restore drill for real** and record the measured time — converting the RTO
   from an estimate into a number.
2. **Generate the OpenAPI document and the typed client**, closing the loop on the
   single-source-of-truth claim.
3. **Front Door, WAF and private networking** for Postgres (currently stubbed).
4. **The backup cron job and absence alerts** (currently stubbed) — the gap between a
   designed backup and a working one.
5. **A seeded demo dataset** so the API can be explored without writing SQL.
6. **Load test at 10× concurrency** to replace the arithmetic in
   [04-scalability-reliability.md](./04-scalability-reliability.md) with measurements.
