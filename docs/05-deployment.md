# E. Deployment Strategy

See the [deployment diagram](../README.md#deployment) and
[`infra/terraform/`](../infra/terraform).

## Why not AWS `me-central-1` — the decision that drove everything else

The brief assumes "cloud-hosted production deployment in the UAE", and Section 2 invites
us to challenge assumptions. Here the assumption survives, but the obvious
implementation of it does not.

**What happened.** On 1 March 2026, Iranian drone strikes damaged AWS data centres in
the UAE and Bahrain. Two of three availability zones in `me-central-1` (`mec1-az2`,
`mec1-az3`) were hit; AWS reported "sparks and fire" inside a facility and advised
customers to move workloads to other regions.

**Where it stands.** As of mid-November 2026 the region remains impaired. AWS's status
page states it "is currently unable to reliably support customer applications", there is
no firm restoration timeline, and AWS has stated it is **unable to restore access to data
hosted exclusively in `mec1-az2`** — that data is permanently gone.

*(Sources are third-party reporting and status aggregators — DataCenterDynamics, InfoQ,
Tom's Hardware. Verify the current state on the AWS Health Dashboard before relying on
it.)*

**Why Google Cloud cannot satisfy the requirement either.** GCP has no UAE region. The
nearest are `me-central1` (Doha, Qatar) and `me-central2` (Dammam, Saudi Arabia).
Latency is a non-issue — Dubai→Doha is ~10–20 ms — but residency is a legal and
contractual property, not a performance one. "Hosted in the UAE" and "hosted in Qatar"
are different answers to the question asked.

**Therefore Azure.** UAE North (Dubai) primary, UAE Central (Abu Dhabi) for DR — the only
provider currently offering an in-country primary *with* an in-country DR region. This is
a region-geography decision, not a claim that Azure is the better cloud.

**The honest caveat.** We found no credible confirmation that Azure UAE was damaged in
March, and Microsoft denied outages at the time — but absence of confirmed damage is not
safety. Azure UAE North sits in the same geography and the same threat envelope. The
position we actually hold is:

> In-country hosting is a **residency** requirement, not a **resilience** strategy. No
> single-provider, in-country deployment survives this class of risk. The control is
> encrypted backups held out of country and out of provider, with a restore that has
> been performed and timed.

## Infrastructure

| Component | Service | Sizing at launch |
|---|---|---|
| API | Container Apps | 2–6 replicas, 0.5 vCPU / 1 GiB |
| Database | PostgreSQL Flexible Server, VNet-only | `GP_Standard_D2ds_v4`, 64 GB, zone-redundant HA |
| SPA | Blob static website | — |
| Edge | Front Door **Standard** | One hostname; `/api/*` to the API, the rest to the SPA; one rate-limit rule |
| Images | Container Registry (Basic, no admin user) | — |
| Secrets | Key Vault (RBAC) + managed identity | — |
| Telemetry | Log Analytics + Application Insights | 90-day retention |

**Why the database is not the Burstable `B2s` an earlier version of this table named.**
Azure does not offer high availability on Burstable SKUs, so "B2s with zone-redundant
HA" cannot be created. That was found by writing the Terraform, not by reading a
pricing page; the `postgres` module now rejects the pair and a test pins it. The
reliability argument below (the single-AZ row of the RPO/RTO table) depends on HA, so
HA was kept and the SKU moved to the smallest General Purpose size. It costs more, the
cost table below says how much, and the cheaper pairing — B2s without HA — is one of
the 40% levers rather than the launch configuration. Reverting is three lines in
`stacks/prod/base/locals.tf`.

**What "Front Door" does and does not mean here.** Standard, not Premium. Standard has
no managed WAF rule sets (OWASP, bot protection) and no Private Link origins, so the
WAF is **one per-IP rate limit**, and both origins also answer directly on their own
hostnames — the edge can be bypassed. Premium closes both gaps at roughly ten times
the base price. This is recorded as a known gap in
[`infra/terraform/README.md`](../infra/terraform/README.md#known-gaps), not presented
as a web application firewall.

**No Kubernetes.** Containers plus managed Postgres means the same image runs under
`docker compose` on one VM — which is how "single server" and "budget cut 40%" are
answered without redesign.

**No stored credentials anywhere.** CI authenticates to Azure via **OIDC federation**;
the app pulls its image and reads its secrets with a **user-assigned managed identity**.
No registry password, no connection string in GitHub, none in the repository — and,
because the generated passwords are passed only to write-only arguments, none in
Terraform state.

**The pipeline can ship a revision and nothing else.** The Terraform is split so that
this is a property of the code: `shared` and `<env>/base` (identity, network, database,
Key Vault, and the deploy identity's own grants) are applied by a human operator group;
`<env>/app` (the container app and the migration job) is applied by CI. The deploy
identity holds a custom role of nine listed actions on the app resource group, no
`delete`, no role-assignment write, and nothing on the network, the database or Key
Vault. The full list, and the honest limit of it — shipping a revision is running code
as the API's identity, and the pipeline can start the migration job, which runs as the
database owner — is in
[`infra/terraform/README.md`](../infra/terraform/README.md#what-the-deploy-identity-can-do)
and [ADR 0005](./adr/0005-terraform-privilege-split.md).

## Environments

| Environment | Purpose | Differences |
|---|---|---|
| local | A developer's machine | `docker compose`: API + Postgres. Identical image. |
| `dev` | Pre-production, on Azure | Burstable `B2s`, single zone, no HA, no geo-redundant backup; 1–2 replicas; 30-day logs |
| `prod` | Production | General Purpose, zone-redundant HA, geo-redundant backup; 2–6 replicas; manual approval gate |

`dev` and `prod` are the same Terraform files; everything that differs is in the first
block of each stack's `locals.tf`. Each stack has its own state, in its own blob
container, because blob RBAC stops at the container. One registry serves both:
production never builds, it deploys the image **digest** `dev` pushed and tested.
Production deploys require approval through a GitHub environment, which is configured
in GitHub and not in this repository.

An earlier version of this table called the pre-production environment `staging` and
described Terraform workspaces. The code has two Azure environments named `dev` and
`prod` and no workspaces; the table now says what exists. Anonymised production data in
`dev` is a process that is not built.

## CI/CD

```
PR:    install → build packages → typecheck → lint (type-aware) → lint:boundaries
                → unit tests → integration tests (Testcontainers + real Postgres)
                → smoke: the containerised stack, migrated, checked over HTTP
                → terraform: fmt, validate, mocked-provider tests, tflint

deploy (NOT WRITTEN — the shape the infrastructure is built for):
         → dev only: build image, push to ACR (OIDC, no secret), record the digest
           prod: take the digest dev deployed
         → point the MIGRATION JOB at the new image (a targeted apply)
         → start the job inside the VNet and wait  ← before the app changes
         → full apply: create or roll the Container App revision
         → upload the SPA bundle; smoke check /api/v1/health through the edge
         → on failure: re-apply the previous digest (schema unchanged)
```

The PR half is real and runs in `.github/workflows/ci.yml`. The deploy half is prose:
there is no Azure subscription and no deploy workflow. The migration runs as a
Container Apps Job rather than from the runner because Postgres has no public endpoint,
so a hosted runner cannot reach it.

**Migrations never run on container start.** Two booting replicas would race the same
migration. They run as their own job, before the deploy, with the application still on
the previous image — which is exactly why every migration must be backward-compatible
with the *currently deployed* API, not merely with the one being shipped.

### When a deployment fails after a schema change

The scenario named in the brief. The answer is a property of the migration strategy
rather than a runbook:

1. Migrations are **forward-only**. There are no down migrations in production, because a
   down migration that touches data is untested fiction under pressure.
2. Every migration is **additive and backward-compatible**, so the previous image runs
   correctly against the new schema. Rollback = redeploy the previous image. Schema
   untouched, zero data loss.
3. Destructive changes are **split across two releases**: expand (add the new column,
   backfill, dual-write) → ship → contract (drop the old column) in a later release once
   no deployed code references it.
4. Restore from backup is the **last** resort, with a known, measured RTO — not the first.

## Security

| Control | Implementation |
|---|---|
| Tenant isolation | Postgres RLS + composite FKs + app-layer scoping |
| Authorization | One CASL policy: deny-by-default guard per route, compiled row filters in every repository read; route coverage asserted in CI |
| Input | Every route declares its schemas; unknown keys refused; an undeclared read fails closed |
| Errors | One responder; unexpected failures redacted to a blanket message, cause chain logged only |
| Transport | TLS everywhere; `require_secure_transport = ON` on Postgres |
| Secrets | Key Vault + managed identity; no deployed secret in CI or repo. The one committed env file, `.env.development`, holds local-only values, encrypted with dotenvx; its key is not committed |
| Credentials | better-auth: memory-hard password hashing, revocable database sessions, TOTP available *(named in [01 §7](./01-technology-stack.md#7-authentication--better-auth-users-in-our-own-postgres); not integrated in this slice)* |
| Database access | App connects as a non-owner `NOBYPASSRLS` role holding a per-table privilege matrix with no `DELETE`; checked at boot, and the API refuses to start otherwise |
| Deploy identity | Federated to one repository + environment; can write the app resource group and nothing that decides who can reach what |
| Edge | Front Door Standard: TLS and one rate-limit rule. No managed WAF rules, and origins are reachable directly *(written, unapplied; gaps named above)* |
| Network | Postgres is VNet-only. Key Vault, registry and storage still have public endpoints behind Entra ID + RBAC |
| Audit | Recorded facts are read, append, void: never edited, never deleted. Parents of facts `RESTRICT`; the application role cannot delete at all |
| Data residency | Primary, DR, telemetry and identity all in-country; backups leave as ciphertext only |
| Patching | Managed services; base image rebuilt on every deploy |

**UAE PDPL considerations.** Athletes are frequently minors and performance data is
health-adjacent, so: lawful basis and guardian consent for minors, data-subject access
and deletion requests (which the no-`DELETE` matrix and `ON DELETE RESTRICT`
deliberately complicate — deletion requests are handled by anonymisation of the athlete
record, preserving the integrity of historical registers; a true erasure is a platform
operation under the owner identity, not something the API can do), and cross-border
transfer handled by client-side encryption with
in-country key custody.

## Backup, and the RPO/RTO table

A single RPO/RTO pair hides the fact that recovery differs by failure mode, so:

| Failure scenario | Mechanism | RPO | RTO | Notes |
|---|---|---|---|---|
| Bad `UPDATE` / accidental delete | PITR, in-region | ~5 min | ~1 h | Most common real incident |
| Single AZ lost | Zone-redundant HA | ~0 | minutes | Automatic failover |
| UAE North region lost | Geo-redundant backup → UAE Central | ~15 min | ~4 h | Requires infra rebuild, below |
| Both UAE regions / provider lost | Nightly off-provider encrypted dump | **up to 24 h** | ~8–24 h | Stated plainly: this tier is nightly |
| Backup key lost | — | — | — | Unrecoverable. Hence `prevent_destroy` + purge protection on the Key Vault key |

**The 4-hour RTO is not just a database restore.** It decomposes into:

| Step | Estimate |
|---|---|
| Decision to fail over | 15 min |
| `terraform apply` in DR region | 20 min |
| Secrets / Key Vault availability in DR | 15 min |
| Database restore from geo-redundant backup | 60–120 min |
| Migration state verification | 10 min |
| Identity: sessions invalidated → users re-authenticate | 5 min |
| DNS / Front Door origin cutover (TTL-bound) | 15 min |
| Smoke verification | 15 min |

Identity is cheap to recover precisely *because* users and sessions live in the same
Postgres — a third-party IdP would add an independent recovery dependency here.

**Targets are deliberately modest.** An academy management platform is not
life-critical: if attendance recording is unavailable for two hours, coaches use paper
and sync later — which the idempotent write API already supports. Engineering to RPO-zero
would be the mistake the brief's final scenario is looking for.

## Indicative monthly cost

Azure UAE North, USD. **Rebuild these in the Azure pricing calculator before relying on
them** — UAE North carries roughly a 10–25% premium over West Europe, and these are
shapes rather than quotes.

| Component | Launch (~200 concurrent) | 10× (~2,000 concurrent) |
|---|---|---|
| Container Apps (API) | 45–70 | 150–250 |
| PostgreSQL Flexible Server (`D2ds_v4`, 64 GB) | 150–180 | 450–700 (incl. read replica) |
| Zone-redundant HA uplift (a second server) | 150–180 | included above |
| Blob + Front Door | 40–60 | 100–150 |
| Container Registry, Key Vault | 10–15 | 15–25 |
| Log Analytics + App Insights | 20–30 | 65–125 |
| Geo-redundant backup | 10–20 | 25–40 |
| Off-provider encrypted dump | 1–5 | 5–10 |
| **Total** | **~$430–560** | **~$810–1,300** |

Launch without zone-redundant HA: **~$280–380/month**. On Burstable `B2s` without HA
(the configuration `dev` runs): **~$220–320/month**.

**These totals rose by about $140 when the SKU was corrected**, and the two database
rows are the least certain numbers in this document. They were derived from the
General Purpose list price in a cheaper region plus the regional premium, not read from
the calculator for UAE North; and HA is priced as a second server because that is what
it is. The 10× column was not re-derived.

**Assumptions:** ~20 academies; < 2 GB database growing ~0.5 GB/year; ~50 GB/month
egress at launch; 5–10 GB/month log ingestion; non-production environments scale to zero
outside working hours.

### When the budget is cut by 40%

The first lever is **commercial, not architectural** — and getting that order right is
the point:

| Step | Saving | What it costs |
|---|---|---|
| 1-year reservation on Postgres compute | 30–40% of the DB lines: ~$100–125 | Nothing. No design change, no guarantee weakened. |
| Right-size after measuring | 10–20% | Nothing, if measurement says so |
| Drop zone-redundant HA | ~$150–180 | AZ failure becomes a ~1 h restore instead of automatic failover. State the new RTO. |
| Then Burstable `B2s` | ~$60 | Slower under sustained load. Only available once HA is off: Azure has no HA on Burstable |
| Front Door → Blob + Cloudflare | ~$35 | A second vendor at the edge. Little security is lost: the Azure WAF here is one rate limit |
| Log retention 90 → 30 days | ~$10 | Shorter forensic window |
| **Result, all levers** | | **~$150–240/month** |

A 40% cut is ~$170–225. **The reservation alone no longer reaches it**: it is about a
quarter of the bill, where on the cheaper SKU an earlier version of this table implied
the commercial lever might be enough. The honest answer is the reservation **plus
dropping HA**, which together clear the target and cost exactly one thing — an AZ
failure becomes a restore. Everything below that line is headroom, not necessity.

**Single-server fallback** (the brief's other scenario): one VM running API + Postgres +
Caddy under `docker compose`, backups to object storage — **~$80–100/month**. The price
is named honestly: no HA, brief downtime on deploy, Postgres patching becomes ours, and
RPO depends on our own dump cadence. The application does not change, because it was
never allowed to depend on anything that would have to.

## Monitoring and alerting

OpenTelemetry → Application Insights, structured JSON logs correlated by request id and
`academy_id`. Telemetry stays in-region because logs carry athlete names and coach notes.

Alerts that page someone — kept short on purpose, because an alert nobody acts on trains
people to ignore the ones that matter:

1. 5xx rate above threshold over 5 minutes
2. p95 latency above threshold over 10 minutes
3. Database connection saturation above 80%
4. Database storage headroom below 20%
5. **Backup did not run in 26 hours**
6. **Restore drill failed, or has not succeeded in 35 days**

The last two alert on *absence*, which is the failure mode nobody notices until they
need the thing that stopped working.
