# B. Architecture Design

See the [architecture diagram](../README.md#architecture) for the component view.

## Shape: a modular monolith, one deployable

One NestJS process, one container image, one database. Feature modules
(`athletes`, `teams`, `sessions`, `auth`) are organised as *extraction seams* rather
than as services: each could become a separate deployable later, and none is one today.

**Why this, concretely.** The brief gives 100–200 concurrent users growing 5–10× — about
2,000 at the ceiling — and a small development team. At that size, distributed
architecture spends the team's entire budget on coordination: network failure modes,
distributed transactions, per-service observability and deployment. A single process on
a single managed container handles this load with headroom.

It also makes two of the brief's discussion scenarios answerable without redesign:

- *"must initially run on a single server"* — the same image under `docker compose` on
  one VM, with Postgres alongside it.
- *"budget reduced by 40%"* — fewer replicas and a smaller database tier; the
  architecture does not change.

## How business logic is organised

Three layers inside each feature module, with a single direction of dependency:

```
controller   HTTP and Zod validation only. No business rules.
    ↓
service      Business rules. Owns the transaction boundary. Calls policies.
    ↓
repository   The only place SQL exists. Cannot run outside a tenant transaction.
```

**What makes this real rather than aspirational.** The repository takes no connection
argument — it reads the transaction from `AsyncLocalStorage`, published by
`TenantTransactionInterceptor`, which has already applied the tenant key. Calling a
repository outside a tenant transaction throws. "Unscoped query" is therefore not a
mistake a developer can make here; it is a shape the code does not have.

And the boundaries are enforced by `dependency-cruiser` in CI
([`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs)):

| Rule | What it prevents |
|---|---|
| `no-controller-to-repository` | Bypassing the transaction boundary and policy checks |
| `no-repository-to-service` | Inverting the layer direction |
| `no-cross-module-internals` | One module reaching into a sibling's internals instead of its public service |
| `no-sql-outside-repositories` | The schema being imported anywhere SQL should not be |
| `contracts-stay-pure` | Server-only dependencies leaking into the browser-shared package |
| `no-circular` | Dependency cycles that make modules unextractable |

Every legitimate exception is listed in that file *with its justification*, including
why `PolicyService` owns its own reads (routing them through feature repositories would
make the common layer depend on feature modules — a worse coupling than the one it
would remove).

## Cross-cutting concerns, and where each one lives

| Concern | Where | Why there |
|---|---|---|
| Authentication | `PrincipalMiddleware` | Attaches a principal or nothing; never rejects, so the refusal decision stays in one place |
| Coarse authorization | `AuthorizationGuard` (global, deny-by-default) | Static role checks before the handler runs; a route with no decision is refused |
| Tenant scoping | `TenantTransactionInterceptor` + RLS | Must be impossible to forget, so it is structural rather than per-query |
| Resource authorization | `PolicyService`, called from services | Relational and temporal; needs the database and deserves a real 403 rather than an empty result |
| Validation | Zod schemas from `packages/contracts` | One definition shared with the OpenAPI document and the client |
| Concurrency | `ETag`/`If-Match` → compare-and-set on `version` | Native HTTP semantics; the stale writer gets 409 |

## Why roles and responsibilities are enforced in different places

The brief says *"based on user roles **and responsibilities**"* — and those are two
different things.

**Roles** are coarse and static: `platform_admin`, `academy_admin`, `coach`, `athlete`,
held per academy in `user_academy_roles` so one person can be a coach at academy A and
an administrator at academy B. Checked by the guard.

**Responsibilities** are relational and temporal: *which* teams a coach is assigned to,
over *which* period. Checked in the service via `PolicyService`.

The case that justifies the split, and the most interesting authorization question in
the domain:

> A coach who leaves a team in March keeps access to the assessments **they authored** —
> that is a historical record, and revoking it would falsify the record. But they lose
> access to that team's roster today, because their assignment period has closed.

Visibility follows the temporal assignment, not a flag on the user. History and
authorization turn out to be the same model.

**Why role logic is deliberately *not* pushed into RLS**, even though it would be
leak-proof: authorization in SQL is hard to unit-test, hard to evolve, and turns a 403
into an inexplicably empty result set. RLS stays coarse and absolute — the tenant
boundary — and nothing more.

## Limitations of this architecture

Stated here rather than discovered in review:

1. **One blast radius.** A memory leak in reporting degrades attendance recording.
   Mitigation: the modules are extraction seams; the first candidate to split out is
   reporting, because it is the only read-heavy, CPU-shaped workload.
2. **No per-module scaling.** Everything scales together. Acceptable while the whole
   application fits comfortably in one container; the trigger to revisit is a module
   whose resource profile diverges from the rest.
3. **Every request holds a transaction.** A slow handler holds a connection for its
   whole life. Mitigation: statement timeouts, no external HTTP calls inside a request
   transaction, and read-only transactions on a replica if read volume ever justifies it.
4. **Boundaries rest on a lint rule.** A determined developer can delete the rule. That
   is a code-review question, not an architecture question — but it is honest to say that
   a network boundary would be stronger, and that we judged it not worth its cost here.
5. **Single-region primary.** The most significant risk, addressed in
   [04-scalability-reliability.md](./04-scalability-reliability.md) and
   [05-deployment.md](./05-deployment.md) rather than pretended away.
