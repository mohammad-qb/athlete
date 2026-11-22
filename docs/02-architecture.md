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
controller   HTTP only: declares the route's permission and its input schemas.
    ↓
service      Business rules. Asks the ability about a row it holds; passes the
             access filter down.
    ↓
repository   The only place SQL exists. Cannot run outside a tenant transaction,
             and cannot be called without an access filter.
```

**What makes this real rather than aspirational.** The repository takes no connection
argument — it reads the transaction from `AsyncLocalStorage`, published by
`TenantTransactionInterceptor`, which has already applied the tenant key. Calling a
repository outside a tenant transaction throws. "Unscoped query" is therefore not a
mistake a developer can make here; it is a shape the code does not have.

The same is true one level up. Every repository read, and the versioned update, takes a
**required** `access` parameter: the predicate compiled from the caller's permissions.
A read written without it does not compile, so "forgot the authorization filter" is a
type error rather than a review comment.

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

Every legitimate exception to `no-sql-outside-repositories` is listed in that file
*with its justification*, and the list got shorter when authorization moved to the
ability: the service that used to run its own authorization queries is gone, and the
condition→SQL compiler takes a column map as a parameter rather than importing the
schema, so it needs no exception at all.

## Cross-cutting concerns, and where each one lives

| Concern | Where | Why there |
|---|---|---|
| Authentication | `AuthenticationGuard` (global) | Attaches a principal or nothing; never rejects, so the refusal decision stays in one place. A guard rather than middleware: see the README's second finding |
| Route authorization | `AuthorizationGuard` (global, deny-by-default) | Asks the **coarse** ability "may this role ever do this?". A route with no declaration is refused |
| Input validation | `@Validate` + `ValidationInterceptor` (global) | Schemas from `packages/contracts`; a handler that reads input it declared no schema for is refused, so forgetting fails closed. Runs before the transaction opens |
| Tenant scoping | `TenantTransactionInterceptor` + RLS | Must be impossible to forget, so it is structural rather than per-query |
| Resource authorization | The **scoped** ability: `accessFilter` in repositories, `assertCan` in services | "To which rows?" Relational and temporal; needs the database, and deserves a real 403 rather than an empty result |
| What the database will accept | A privilege matrix on the application's role | The floor under all of the above; see [below](#the-floor-what-the-database-refuses) |
| Concurrency | `ETag`/`If-Match` → compare-and-set on `version` | Native HTTP semantics; the stale writer gets 409 |
| Errors | `ApiError` + one terminal responder | One body shape and one log line per failure; unexpected errors are redacted, their cause chain logged |

## Authorization: one policy, asked two ways

The brief says *"based on user roles **and responsibilities**"* — and those are two
different things.

**Roles** are coarse and static: `platform_admin`, `academy_admin`, `coach`, `athlete`,
held per academy in `user_academy_roles` so one person can be a coach at academy A and
an administrator at academy B.

**Responsibilities** are relational and temporal: *which* teams a coach is assigned to,
over *which* period.

Both are expressed in **one** function, `defineAbility` in
[`common/authz/ability.ts`](../apps/api/src/common/authz/ability.ts), using
[CASL](https://casl.js.org). Every grant in the system is in that function, each with a
comment saying why; a role check written anywhere else is a bug. The policy is then
asked two different questions at two different moments.

| | Coarse | Scoped |
|---|---|---|
| Question | May this role *ever* do this? | To *which rows*? |
| Built | In the guard, from the roles the user holds in the session's academy | Inside the tenant transaction, once per request |
| Rules | No conditions | Conditions over the principal's resolved scope |
| Used by | `@Permission({ action, subject })` on every route | Repository filters and instance checks |
| Refusal | 403 before any query | 403 or 404, below |

**Why two modes rather than one ability.** Nest runs guards before interceptors, and a
coach's scope needs a query inside the transaction the interceptor opens, so the guard
cannot have the conditions. More importantly, it should not: `can('read', 'athletes')`
on a *conditional* rule answers true for a type-level check, which is how a customer's
scoped `read` grant ends up satisfying a back-office route in designs that use one
ability for both jobs. Here the guard only ever sees unconditional rules, and a test
asserts that the two modes agree on which `(action, subject)` pairs exist and that
scoped never grants what coarse refuses.

**How the scoped ability reaches the database.** A rule condition is a plain object,
`{ teamId: { $in: activeTeamIds } }`. CASL evaluates it in memory against a loaded row
for free. The other direction is hand-written and small: `toSqlWhere` compiles one
condition to a Drizzle `SQL` predicate, and `accessibleBy` merges a principal's rules
for an action using CASL's own rule-merging, so the SQL and the in-memory answer share
one set of priority semantics. Together they are about 300 lines. Three properties
were chosen deliberately:

- **No grant is never "no filter".** When nothing grants the action, `accessibleBy`
  throws `FORBIDDEN`. The natural bug in a query-filter helper is returning an
  unfiltered query when it finds no rule.
- **Unknown is loud.** An operator the compiler does not know, a field with no mapped
  column, or a nested (relation) condition throws. A restriction is never dropped.
- **SQL and memory agree on `NULL`.** Negations and orderings are compiled to match
  CASL's matcher on null columns, cross-checked against the real matcher in tests.

**Conditions are flat, and that is the load-bearing limit.** A condition may name only
columns of the subject's own table. A coach's scope is therefore resolved **once per
request** into two id lists at one instant, `asOf`, taken from the database
transaction's clock: the teams they coach now, and the athletes on those teams now.
Rules read `{ teamId: { $in: activeTeamIds } }` instead of traversing
assignment → team → membership. The cost is one or two extra queries per coach request
and an `IN` list; the gain is that the in-memory check and the SQL filter cannot
disagree, because neither has a relation to interpret differently. The scale ceiling
this creates is in the limitations below.

**The case that justifies the temporal model**, and the most interesting authorization
question in the domain:

> A coach who leaves a team in March loses access to that team's roster today, because
> their assignment period has closed — but the assessments **they authored** are a
> historical record, and revoking those would falsify it.

Visibility follows the temporal assignment, not a flag on the user. History and
authorization turn out to be the same model. The first half is built and tested: the
same coach, the same data, refused at one instant and admitted at another thirty days
earlier (`authz.resource-scoping.integration`). The second half is designed and **not
built**: `assessments` is a reserved subject whose author field is already in the
policy's row types, but no rule grants on it and no route serves it in this slice.

**403 or 404.** A principal who names a scope key they do not hold — an athlete id, a
team id — is told so: 403, before any read, and the answer is the same whether or not
the row exists. A row that is merely absent from the filtered result is a 404. A coach
with **no** active assignment gets no rule at all rather than a rule over an empty
list, so they get a 403 that says why instead of an inexplicably empty page.

**Tenancy is not in the policy.** No rule carries an `academyId` condition. RLS draws
the tenant boundary on the transaction every query runs in; a tenant clause in the
ability would be a second, weaker statement of a guarantee the database already makes,
and a place for the two to disagree. `platform_admin` holds `manage all`, which
therefore means "everything in the academy the session is acting in", not "everything".

**Why role logic is not pushed into RLS**, even though it would be leak-proof:
authorization in SQL policies is hard to unit-test, hard to evolve, and turns a 403
into an inexplicably empty result set. RLS stays coarse and absolute — the tenant
boundary — and nothing more.

The route × action × subject table is generated from the same metadata the guard reads
and committed as [`reference/route-manifest.md`](./reference/route-manifest.md); a test
fails when it drifts. The decision record, including the earlier rejection of CASL and
why it was reversed, is [ADR 0002](./adr/0002-casl-over-a-static-permission-map.md) and
[ADR 0003](./adr/0003-flat-conditions-and-resolved-scope.md).

## The floor: what the database refuses

Everything above runs in the application, and an application has bugs. So the role the
API connects as, `athlete_app`, is granted only what the API should ever ask for, and
the tenancy story has a second half: RLS decides **which rows**, the grant matrix
decides **which operations**.

| Tables | `athlete_app` may | Why |
|---|---|---|
| `athletes`, `teams`, `training_sessions` | `SELECT`, `INSERT`, `UPDATE` | Mutable entities. Each is a parent of recorded facts, so no `DELETE` |
| `session_participants`, `assessments` | `SELECT`, `INSERT`, `UPDATE (voided_at, voided_by)` | Recorded facts: read, append, void. A wrong fact is voided and replaced, never edited |
| `team_memberships` | the same, plus `UPDATE (valid_to)` | A membership is also a period; closing it is how a transfer works |
| `team_coach_assignments` | `SELECT`, `INSERT`, `UPDATE (valid_to)` | A period that grants visibility: opened and closed, never rewritten |
| `academies`, `user_academy_roles` | `SELECT` | The application cannot create a tenant or mint a role |
| `users` | nothing | Holds credentials and has no tenant policy |
| any table a later migration adds | nothing, until that migration grants it | The blanket default from `0001` is revoked |

No `DELETE` on anything. A trigger makes `valid_to` and the voiding columns final once
set, so the application role cannot reopen a closed coach assignment or undo a void.
The two foreign keys that used to cascade from a parent onto recorded facts now
`RESTRICT`.

**The API checks this at boot and refuses to start otherwise**: not a superuser, no
`BYPASSRLS`, not a table owner, no role it could `SET ROLE` into, and no privilege
beyond the matrix on any table the matrix names. Pointing `DATABASE_URL` at the owner
silently voids RLS and this whole table with nothing logged — and it was not
hypothetical: the compose stack was doing exactly that, so the smoke script's
"tenant isolation over HTTP" checks had been passing on application predicates alone.
The boot assertion is what found it. See
[ADR 0004](./adr/0004-privilege-matrix-and-voiding.md) and
[03-data-model.md](./03-data-model.md#the-privilege-matrix).

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
5. **Coach scope is an `IN` list.** Flat conditions mean a coach's visible athletes are
   resolved to ids per request and bound as parameters. At this scale that is tens of
   teams and a few hundred athletes at most, and administrators pay nothing. It stops
   being reasonable when one principal's scope reaches thousands of ids — a
   federation-wide "head coach" role would do it. The exit route is known: a relation
   filter in the query (Drizzle's relational query API, v2), which is the approach a
   sibling project of ours takes. It was not taken now because it needs
   `drizzle-orm@1.0.0-rc` and reintroduces the SQL-versus-memory asymmetry flat
   conditions exist to avoid.
6. **Scope is resolved at the start of the request.** An assignment that closes
   mid-request is honoured until the request ends. Requests are short and this is the
   same consistency a transaction snapshot gives; it is stated because "as of when?" is
   the question temporal authorization always has to answer.
7. **The boot assertion restates the grants.** The privilege matrix exists once in the
   migration and once in code. A migration that widens a grant on a matrix table must
   ship after the API version that allows it, or the API refuses to boot. Tables a
   later migration adds are not judged.
8. **Single-region primary.** The most significant risk, addressed in
   [04-scalability-reliability.md](./04-scalability-reliability.md) and
   [05-deployment.md](./05-deployment.md) rather than pretended away.
