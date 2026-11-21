# D. Scalability and Reliability

## First, the arithmetic

The brief's numbers invite over-engineering, so it is worth doing the sums out loud
before reaching for any architecture.

| Quantity | At launch | At 10× | At "50,000 athletes" |
|---|---|---|---|
| Athletes | 5,000 | 50,000 | 50,000 |
| Coaches | 300 | 3,000 | 3,000 |
| Concurrent users | 100–200 | 1,000–2,000 | 1,000–2,000 |
| Teams (≈25/team) | ~200 | ~2,000 | ~2,000 |
| Sessions/year (≈300/team) | ~60,000 | ~600,000 | ~600,000 |
| Attendance rows/year (≈18/session) | ~1.1M | ~11M | ~11M |
| Assessments/year (≈6/athlete) | ~30,000 | ~300,000 | ~300,000 |
| Total DB size after 5 years | < 2 GB | ~20 GB | ~20 GB |

**Conclusion: this is a small database and a small amount of traffic.** 2,000 concurrent
users of a CRUD application is a few hundred requests per second at peak, and tens of
millions of rows is unremarkable for Postgres with correct indexing. The honest answer to
"how will you handle growth" is therefore *"the design does not need to change; here are
the numbers"* — and that answer is worth more than a scaling diagram.

**So the 50,000-athlete scenario changes nothing structural.** In order: verify index
usage on the tenant-leading composite indexes; add a read replica for reporting if
report queries begin competing with transactional work; partition `session_participants`
by month if it ever exceeds ~100M rows. Not sharding. Not a rewrite.

## Scaling, in the order we would actually do it

1. **Horizontal API replicas.** Stateless (sessions in Postgres, no in-memory state), so
   replicas scale on HTTP concurrency. 2 → 6 covers the 10× case.
2. **Indexes before infrastructure.** `log_min_duration_statement = 1000` is on from day
   one so slow queries are evidence rather than speculation.
3. **Connection pooling.** Container Apps replicas × pool size must stay under the
   server's connection limit; a transaction-mode pooler sits in front if replica count
   grows. Our transaction-scoped `set_config` is compatible with that by design — a
   session-level `SET` would not have been.
4. **Read replica for reporting.** The first genuinely divergent workload. Read-only
   transactions, same RLS policies.
5. **Caching, last and narrowly.** Rosters and team lists are the only plausibly hot,
   rarely-changing reads. Deliberately not added now: cache invalidation across a
   temporal data model is a correctness risk, and there is no measurement yet that says
   it is needed.

## If the database becomes the bottleneck

Diagnose in this order, because the cheap causes are overwhelmingly the likely ones:

| Likely cause | Diagnosis | Fix |
|---|---|---|
| Missing or wrong index | `pg_stat_statements`, slow-query log | Add the index. Most "we need to scale" moments are this. |
| N+1 queries | Request traces in Application Insights | Batch or join |
| Long transactions holding connections | `pg_stat_activity` | Statement timeouts; no external HTTP calls inside a request transaction |
| Reporting competing with writes | Query mix by endpoint | Read replica |
| Genuinely insufficient resources | Sustained CPU/IOPS saturation | Vertical scale — a single step from B2s to D4ds_v5 is ~8× the compute |
| Table genuinely too large | Row counts, index bloat | Monthly partitioning of `session_participants` |

Vertical scaling is listed deliberately: at this data size, moving one SKU tier is
cheaper, faster and lower-risk than any architectural change, and pretending otherwise
would be the mistake.

## The most significant technical risks

Ranked honestly — and note that the top risk is **not** a scaling problem.

### 1. Regional loss, with permanent data loss for single-region data

This is no longer hypothetical in this market. On 1 March 2026, drone strikes damaged
AWS facilities in the UAE; two of three availability zones in `me-central-1` went down
together, and AWS has stated it is **unable to restore access to data hosted exclusively
in `mec1-az2`**. As of mid-November 2026 the region remains impaired with no firm
restoration timeline.

**The lesson is architectural, not vendor-specific:** multi-AZ protects against a rack,
power or cooling failure. It does **not** protect against a regional kinetic event.
"Multi-AZ for high availability" is the sentence most proposals stop at, and it would not
have helped here.

**Mitigation:** in-country primary with in-country DR (Azure UAE North → UAE Central),
*plus* nightly encrypted dumps held out of country and out of provider — ciphertext only,
keyed from in-country Key Vault — *plus* a scheduled restore drill whose measured elapsed
time **is** the RTO rather than an estimate of it. A backup that has never been restored
is a hypothesis.

### 2. Cross-tenant data leak

The worst-case failure for a multi-academy platform: not downtime, but one academy
seeing another's athletes. Mitigated with three independent mechanisms (RLS with
`WITH CHECK`, composite foreign keys, application-layer scoping), a fail-closed default,
and tests that run as the actual `NOBYPASSRLS` application role.

### 3. A schema change that breaks a running deploy

Mitigated by forward-only expand/contract migrations, each backward-compatible with the
*currently deployed* API, run as a separate CI job before the app deploy — never on
container start, where two booting replicas would race. Rollback is "redeploy the
previous image"; the schema stays. Destructive changes are split across two releases.

### 4. Silent data corruption through concurrent edits

Mitigated by `version`-based compare-and-set returning 409, and by temporal constraints
that make a contradictory history impossible even under concurrency — a second concurrent
transfer fails rather than interleaving.

### 5. A backup that stopped working months ago

The quiet one, and worse than having no backup because it buys false confidence.
Mitigated by alerting on **absence**: "backup did not run in 26 hours" and "restore drill
has not succeeded in 35 days".

### 6. Key-person risk on a small team

Mitigated by choosing boring, widely-known technology, by enforcing architecture in CI
rather than in anyone's head, and by writing down the *reasoning* — which is what this
document set is for.

## What we deliberately did not do, and why

Each of these would have made the proposal look more sophisticated and the system worse:

| Not done | Why |
|---|---|
| Kubernetes | A control plane and cluster upgrades for ~2,000 concurrent users. Revisit when multiple teams need independent deploys. |
| Microservices | Distributed failure modes bought with no scaling need. The module seams exist if that changes. |
| Event sourcing / CQRS | The temporal model already gives truthful history at a fraction of the complexity. |
| Redis cache | Nothing is measured as hot yet, and cache invalidation over temporal data is a correctness risk. |
| Message queue | No asynchronous workload at launch. The first real one (notifications) gets one process and one table-backed queue before it gets a broker. |
| Multi-region active-active | Doubles cost and adds write-conflict semantics to protect against an event whose RTO of 4 hours is acceptable to the business. |

The brief's last discussion scenario — *"a proposed technology adds significant
operational complexity without a clear business benefit"* — is answered by this table
rather than by a sentence.
