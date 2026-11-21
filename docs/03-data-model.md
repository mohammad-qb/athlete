# C. Data and Backend Design

See the [ERD](../README.md#data-model) and the
[request-path sequence diagram](../README.md#request-path--where-tenancy-and-authorization-actually-happen).

Authoritative DDL: [`apps/api/drizzle/0000_init.sql`](../apps/api/drizzle/0000_init.sql)
and [`0001_rls.sql`](../apps/api/drizzle/0001_rls.sql).

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
   reading across tenants.
2. **The login bootstrap problem.** Authentication must find a user before any academy
   is chosen. Rather than weaken RLS, exactly one `SECURITY DEFINER` function with a
   pinned `search_path` provides that lookup, returning role assignments only — never
   domain data. One auditable exception beats a general hole.

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

`ON DELETE RESTRICT` on recorded facts: a register that can be emptied by deleting a
parent row is not a historical record.

Assessments are **append-only** (no `version` column): they are not edited, they are
superseded. `assessed_by_user_id` is what lets a departed coach still read their own work.

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

`REST` under `/api/v1`, generated from the Zod contracts in `packages/contracts`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/athletes` | Tenant-scoped by RLS |
| `GET` | `/athletes/:id` | Returns `ETag` |
| `POST` | `/athletes` | |
| `PATCH` | `/athletes/:id` | Requires `If-Match`; 409 on stale |
| `POST` | `/teams` | |
| `POST` | `/teams/:id/memberships` | Period, not assignment |
| `GET` | `/teams/:id/roster?at=<iso>` | `at` defaults to now — the same endpoint answers "who is" and "who was" |
| `POST` | `/teams/transfers` | Close one period, open another |
| `POST` | `/sessions` | |
| `POST` | `/sessions/:id/attendance` | Idempotent; validates membership *as at session start* |
| `GET` | `/sessions/:id/attendance` | The recorded register |
| `GET` | `/health` | The only `@Public()` route |

Validation errors return field-level issues; authorization failures return a real 403
naming the required roles, not an empty list.
