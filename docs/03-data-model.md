# C. Data and Backend Design

See the [ERD](../README.md#data-model) and the
[request-path sequence diagram](../README.md#request-path--where-tenancy-and-authorization-actually-happen).

Authoritative DDL: [`apps/api/drizzle/0000_init.sql`](../apps/api/drizzle/0000_init.sql),
[`0001_rls.sql`](../apps/api/drizzle/0001_rls.sql) and
[`0002_grants.sql`](../apps/api/drizzle/0002_grants.sql). Migrations are forward-only:
`0002` supersedes parts of the first two rather than editing them, and where a snippet
below shows a constraint, it is the constraint as it stands after all three.

## 1. Preventing unauthorized access between academies

Three independent mechanisms, because one is a single point of failure.

### a. Row-Level Security — the floor

Every tenant-owned table carries `academy_id` and a policy:

```sql
alter table athletes enable row level security;
alter table athletes force row level security;
create policy athletes_tenant_isolation on athletes
  using      (academy_id = app_current_academy())
  with check (academy_id = app_current_academy());
```

`WITH CHECK` as well as `USING`, so a tenant cannot *write* a row into another academy
either. The tenant key arrives transaction-scoped:

```sql
select set_config('app.current_academy_id', $1, true);
```

`set_config(..., true)` rather than literal `SET LOCAL` because only the function form
accepts a bound parameter — interpolating a tenant id into SQL text would create an
injection point in the one place we can least afford one. Being transaction-scoped, it
dies with the transaction, so it cannot leak onto the next request sharing a pooled
connection, and it works correctly behind a transaction-mode pooler.

**Fail-closed by construction:** with no context, `app_current_academy()` returns `NULL`,
`academy_id = NULL` is `NULL`, and nothing is visible. A query that forgets its tenant
context returns *nothing* — it does not return *everything*.

**Two details that decide whether this is real:**

1. **RLS does not apply to the table owner** unless `FORCE ROW LEVEL SECURITY` is set —
   and it **never** applies to a superuser or any `BYPASSRLS` role. The application
   connects as `athlete_app`: non-owner, `NOBYPASSRLS`. The test suite asserts that
   premise before asserting anything else, because the first version of it passed while
   reading across tenants. The API asserts it too, at boot, and refuses to start as
   anything else — because the local compose stack was later found doing the same
   thing over HTTP.
2. **The login bootstrap problem.** Authentication must find a user's academies before
   any academy is chosen. Rather than weaken RLS for the application role, exactly one
   `SECURITY DEFINER` function with a pinned `search_path` provides that lookup,
   returning role assignments and academy names only — never domain data. One auditable
   exception beats a general hole. The first detail bites here: the function reads as
   the *owner*, which `FORCE ROW LEVEL SECURITY` confines too, so it returned nothing
   unless the owner was a superuser. The owner therefore holds a `SELECT` policy of its
   own on the two tables the function reads (`0003_auth.sql`,
   [ADR 0006](./adr/0006-cookie-sessions-and-the-auth-role.md)), and a suite that
   migrates as a non-superuser asserts it.

### b. Composite foreign keys — the part RLS does not cover

RLS stops you *reading* another academy's rows. It does not stop you *referencing* them:
academy A inserting an attendance record pointing at academy B's session passes a plain
foreign-key check. So every parent declares `UNIQUE (academy_id, id)` and every child
references the pair:

```sql
constraint session_participants_session_fk
  foreign key (academy_id, session_id)
  references training_sessions(academy_id, id)
```

A cross-tenant reference is now structurally impossible. Tested in
`tenancy.isolation.integration.spec.ts`.

### c. Application-layer scoping — defence in depth

Repositories still include `academy_id` in every predicate. Redundant by design: if a
policy were dropped by a bad migration, the queries keep behaving correctly instead of
silently widening.

**Why shared-schema at all?** With 15–30 academies (and ~200 at the ceiling),
schema-per-tenant means N migration runs that can partially fail, leaving tenants on
different schema versions — which collides directly with the expand/contract strategy
and with "a deployment fails after a schema change". Database-per-tenant scales cost
with tenant count rather than with load. The accepted trade-off is no physical
separation: one tenant's heavy query can affect others, mitigated with indexes,
statement timeouts and per-tenant rate limits — not with architecture.

## 2. Maintaining historical records

### Membership is a period, not a column

The defect to avoid is a mutable `team_id` on the athlete: the moment it is updated,
every historical report silently re-attributes itself.

```sql
valid_from  timestamptz not null,
valid_to    timestamptz,                      -- NULL = current
period      tstzrange generated always as
              (tstzrange(valid_from, valid_to, '[)')) stored,

constraint team_memberships_no_overlap_same_team
  exclude using gist (athlete_id with =, team_id with =, period with &&)
  where (voided_at is null)        -- a voided membership stops occupying its period
```

**The constraint's scope is a deliberate domain decision.** An athlete *may* belong to
several teams at once — a U17 squad and the first team, football and athletics. What is
forbidden is a duplicate or overlapping period for the **same athlete in the same team**,
which is the actual integrity defect. A blanket "one team at a time" constraint looks
stricter and would be wrong for real academies; any such rule is academy policy and
belongs in the service layer. This is raised as an open requirements question rather
than assumed.

`'[)'` bounds — inclusive start, exclusive end — so a leaver and a rejoiner on the same
timestamp is a legal, gapless history.

A transfer closes one period and opens another, in one transaction. Nothing is
overwritten and nothing is deleted.

### Attendance is a recorded fact, not a derivation

```sql
team_id_at_time  uuid not null,   -- the context AS RECORDED
client_record_id uuid not null,   -- client-generated, enables offline replay
```

If the register were reconstructed from current membership, transferring an athlete
would rewrite last month's attendance sheet — and nobody would notice until an academy
disputed a report. Recording participation as a fact, carrying the team context of the
moment, makes that impossible.

**A fact cannot be removed through its parent.** A register that can be emptied by
deleting a parent row is not a historical record, so the foreign keys from recorded
facts to their parents are `ON DELETE RESTRICT`: `session_participants →
training_sessions`, and `team_memberships → teams` and `→ athletes`. This sentence was
in the first version of this document and was **not true**: those three cascaded until
`0002_grants.sql`, so deleting a session emptied its register. What still cascades, on
purpose: `academy_id → academies` on every table (offboarding a tenant removes the
tenant), and `teams → training_sessions` and `→ team_coach_assignments`, which are not
recorded facts — a session that *has* a register is protected by the first constraint.

Assessments are **append-only** (no `version` column): they are not edited, they are
superseded. `assessed_by_user_id` is what will let a departed coach still read their own
work; that rule is designed and not built, since no route serves assessments in this
slice.

### Correcting a fact: void and replace

A fact recorded wrongly is neither edited nor deleted. It is marked void — by someone,
at a time — and a correct row is inserted beside it, so the wrong version stays on
record as wrong.

```sql
voided_at timestamptz,
voided_by uuid references users(id) on delete restrict,
constraint session_participants_void_attributed
  check ((voided_at is null) = (voided_by is null))   -- no anonymous void
```

on `session_participants`, `assessments` and `team_memberships`. Three things had to
change for a replacement row to be possible and for a void to mean anything:

- "One register entry per athlete per session" became a **partial unique index**
  `where voided_at is null`. Postgres cannot put a `WHERE` on a unique *constraint*,
  and the unconditional one made a replacement impossible.
- The membership exclusion constraint gained the same predicate.
- Every read of a fact, including the query that resolves a coach's scope, goes through
  one shared active-row predicate. A voided membership grants no access.

The idempotency constraint on `(academy_id, client_record_id)` stays unconditional on
purpose: a replayed offline submission must remain a no-op even if the row it first
created was later voided. A replacement is a new record with a new `client_record_id`.

**No route voids anything yet.** The correction path is proven at the database, as the
application role (`privileges.matrix.integration`); a void endpoint is product surface
this slice does not add.

### The privilege matrix

The application's database role cannot do what the application should never ask.
`0001` granted `athlete_app` full DML on every table and made that the default for
every future table; `0002` revokes both and grants back table by table.

| Tables | Granted to `athlete_app` |
|---|---|
| `athletes`, `teams`, `training_sessions` | `SELECT`, `INSERT`, `UPDATE` |
| `session_participants`, `assessments` | `SELECT`, `INSERT`, `UPDATE (voided_at, voided_by)` |
| `team_memberships` | `SELECT`, `INSERT`, `UPDATE (valid_to, voided_at, voided_by)` |
| `team_coach_assignments` | `SELECT`, `INSERT`, `UPDATE (valid_to)` |
| `academies`, `user_academy_roles` | `SELECT` |
| `users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `_migrations`, any future table | nothing |

- **No `DELETE` on any table.** Nothing in the API deletes.
- **`status` on a register entry is not updatable.** Editing a status in place is
  exactly what voiding replaces.
- **A column grant says which column, not which transition**, so a trigger
  (`app_final_once_set`) makes `valid_to` and the voiding columns go from `NULL` to a
  value exactly once for any role that does not own the table. Without it the
  application role could reopen a closed coach assignment — restoring that coach's
  access — or clear `voided_at` to bring a voided fact back. The owner is exempt, so
  the platform can still repair a row under a different identity.
- **`users` and the three `auth_*` tables get nothing.** They hold identity, password
  hashes and live session tokens, and none has an `academy_id`, so none has an RLS
  policy: `SELECT` on them would expose every tenant's credentials to any statement
  running as the application role. They belong to a second role, `athlete_auth`, which
  better-auth alone connects as: `SELECT, INSERT, UPDATE` on `users`, full DML on the
  `auth_*` tables, and nothing on any tenant-owned table
  ([ADR 0006](./adr/0006-cookie-sessions-and-the-auth-role.md)). The password hash
  itself is in `auth_accounts`; `users.password_hash` is gone.

Tested in `privileges.matrix.integration.spec.ts`, inside the tenant, as the
application role; and checked by the API at boot, which refuses to start holding more
than this table (`database-privileges.ts`).

Proven end to end by `history.transfer.integration.spec.ts`: record attendance →
transfer the athlete → February's register and roster are unchanged, today's roster
reflects the new team, and the membership history is two rows rather than one mutated row.

### Querying history

```sql
-- Who was on this team at a given instant?
select a.* from team_memberships m
  join athletes a on a.id = m.athlete_id and a.academy_id = m.academy_id
 where m.team_id = $1 and m.period @> $2::timestamptz;
```

A point-in-time containment test against a GiST-indexed range. No snapshot tables, no
event replay.

## 3. Handling concurrent updates

Optimistic concurrency, expressed in native HTTP. Reads return `ETag: "<version>"`;
writes must send `If-Match`. The update is a compare-and-set:

```sql
update athletes
   set last_name = $3, version = version + 1, updated_at = now()
 where id = $1 and academy_id = $2 and version = $4;
```

Zero rows affected means the caller's copy was stale → **409 Conflict** with instructions
to re-read, rather than a silent overwrite. If the row is simply gone, 404 — the caller
deserves to know which.

**Pessimistic locking (`SELECT ... FOR UPDATE`) was rejected deliberately:** these are
human-paced edits over HTTP, so holding a row lock across user think-time trades a rare,
recoverable 409 for routine lock contention. `concurrency.optimistic-lock.integration.spec.ts`
asserts both halves: the stale writer loses, and a reader is never blocked by an
in-flight writer.

**Idempotent writes.** Attendance submissions carry a client-generated
`client_record_id`, unique per academy, with `ON CONFLICT DO NOTHING`. A retried or
late-syncing offline submission is a no-op rather than a duplicate register entry —
which is what lets a future offline mobile client ship without redesigning this endpoint.

## 4. API design

`REST` under `/api/v1`, described by an OpenAPI 3.1 document
([`apps/api/openapi.json`](../apps/api/openapi.json)) generated from the Zod contracts in
`packages/contracts` and the routes' own declarations.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/athletes` | Paginated. Tenant-scoped by RLS; a coach sees the athletes on teams they coach now. Sort by `lastName`, `firstName`, `dateOfBirth`, `createdAt`; `q` matches first or last name |
| `GET` | `/athletes/:id` | Returns `ETag` |
| `POST` | `/athletes` | |
| `PATCH` | `/athletes/:id` | Requires `If-Match`; 409 on stale; an unknown or empty body is a 400, never a silent 200 |
| `GET` | `/teams` | Paginated; sort by `name`, `q` on the name. A coach sees the teams they coach now |
| `POST` | `/teams` | |
| `GET` | `/teams/:id` | A team outside the caller's scope is a 404 |
| `POST` | `/teams/:id/memberships` | Period, not assignment |
| `GET` | `/teams/:id/roster?at=<iso>` | `at` defaults to now — the same endpoint answers "who is" and "who was". `at` must be an ISO-8601 instant with an offset. It chooses the period shown; authorization is the caller's team scope *today* |
| `POST` | `/teams/transfers` | Close one period, open another |
| `GET` | `/sessions` | Paginated; newest first; optional `teamId`, and `from`/`to` as a half-open period over the start time |
| `POST` | `/sessions` | |
| `GET` | `/sessions/:id` | A session outside the caller's scope is a 404 |
| `POST` | `/sessions/:id/attendance` | Idempotent; validates membership *as at session start* |
| `GET` | `/sessions/:id/attendance` | The recorded register |
| `GET` | `/health` | The only `@Public()` route |

What each route demands of the caller is in the generated
[route manifest](./reference/route-manifest.md).

**Lists are paginated on the server.** A list takes `page` (from 1), `pageSize` (1 to
100, default 25), `sort` (one of the route's listed keys, `-` in front for descending)
and, where there is something to search, `q`; it answers `{ items, total, page,
pageSize }`. An unlisted sort key or an unknown parameter is a 400. `total` is counted
with the same predicate as the page, the caller's access filter included, so a coach's
total is the number of rows that coach may see and says nothing about the rest.

**Every response is declared and encoded.** Each route names its response schema with
`@Responds`, and the result is encoded through it: a field the schema does not name is
not sent, and a result that does not fit is a 500 with code
`response_contract_violation`, never the handler's raw return value.

**Every request part is validated or refused.** Each route declares a schema for the
params, query and body it reads; unknown keys are rejected; and a handler that reads a
part it declared no schema for is refused rather than handed raw input. A PATCH that
names no recognised field is a 400 — it used to validate to `{}`, return 200 and bump
the version, invalidating every other client's `ETag` while changing nothing.

**Every failure has one body shape**: `type` (the stable category: `VALIDATION`,
`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, …), an optional `code` for the specific failure,
`message`, and machine-readable `meta` — for validation, `meta.fields` with each entry's
`in` (`params | query | body`), dot `path` and messages. An authorization failure is a
real 403 naming the operation refused, not an empty list; an unexpected failure is
redacted to `"Internal server error"` and its cause logged.
