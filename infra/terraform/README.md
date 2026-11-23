# Infrastructure

Terraform for the Azure UAE North deployment, structured so that the privilege split is
a property of the code rather than a sentence in a document: **a pipeline identity that
can ship a revision, and humans for everything that decides who can reach what.**

## Status: a reviewed design, never applied

There is no Azure subscription behind this. Nothing here has been planned against Azure
or applied. What has and has not been checked is spelled out under
[What has been verified](#what-has-been-verified); the short version is that the
configuration is well-formed and internally consistent, and that **every statement
about what Azure will accept or refuse — above all the permission lists — is
untested.** Expect corrections on the first real `plan` and `apply`. Saying so is
cheaper than being caught by it.

## Layout

```
.tflint.hcl
modules/                  reusable, no environment literals
  container-app/          the API container app + the migration job
  postgres/               Flexible Server, VNet-integrated, no public endpoint
  static-site/            storage static website for the SPA bundle
  edge/                   Front Door Standard: one hostname, /api/* and SPA routes (only
                          fingerprinted assets cached), WAF rate limit
stacks/                   each directory is an independent root with its own state
  shared/                 state account, image registry, the two CI deploy identities
  dev/
    base/                 network, Postgres, Key Vault + secrets, workload identities,
                          Container Apps environment, static site, edge, backup key,
                          and the deploy identity's grants      -- applied by a human
    app/                  container app + migration job ONLY    -- applied by CI
  prod/
    base/                 same files as dev/base; differs only in locals.tf + backend.tf
    app/                  same files as dev/app;  differs only in locals.tf, backend.tf, data.tf
```

`dev` and `prod` stacks are deliberately the same files. Everything that differs between
environments is in the first block of each stack's `locals.tf`; `diff -r stacks/dev
stacks/prod` shows only that, the state container names, and the names in one test
fixture.

Each stack has its own state **container** in one storage account (`shared`, `dev-base`,
`dev-app`, `prod-base`, `prod-app`). A container per stack, rather than a key per stack
in one container, because blob RBAC stops at the container.

## Who applies what

| Stack | Applied by | When | Why there |
|---|---|---|---|
| `shared` | Operator group (human) | Once, then rarely | It creates the deploy identities. Whoever can edit this can grant CI anything. |
| `<env>/base` | Operator group (human) | On infrastructure change | Identity, network, database, secrets, and the grants in `deploy-access.tf`. |
| `<env>/app` | CI, as the environment's deploy identity | Every deploy, in two applies (job, then everything) | Only the image changes. Nothing in it needs more than "write a container app". |

The operator group is a named Entra ID group passed to `shared` as
`operator_group_object_id` — it has no default, so "who can change identity and
network" is a decision someone made rather than whoever ran the first apply.

Apply order is `shared` → `<env>/base` → `<env>/app`. `app` reads `base` through remote
state; `base` reads `shared`.

### Bootstrap

`shared` creates the storage account its own state lives in. First apply: comment out
the `backend` block in `stacks/shared/backend.tf`, apply with local state, restore the
block, `terraform init -migrate-state`. The account and registry names are globally
unique; change the defaults in `stacks/shared/variables.tf` and the literal
`athletetfstate` in every `backend.tf` / `data.tf` together (backend blocks cannot use
variables).

## What the deploy identity can do

One user-assigned managed identity per environment, with one federated credential whose
subject is exactly `repo:mohammad-qb/athlete:environment:<env>`. No client secret
exists. A pull request, a fork, or a job that does not declare the GitHub environment
gets no token Azure will accept. Two identities, not one: a shared identity would let
the dev workflow act on prod.

This is the complete list. It is defined in two files —
[`stacks/shared/github-oidc.tf`](./stacks/shared/github-oidc.tf) and
`stacks/<env>/base/deploy-access.tf` — and nowhere else.

| Capability | Role | Scope | Why this scope |
|---|---|---|---|
| Read/write its own state | Storage Blob Data Contributor | container `<env>-app` | Narrowest blob RBAC goes without an ABAC condition; the container holds one blob. |
| Read base outputs | Storage Blob Data Reader | container `<env>-base` | See [the next section](#what-the-deploy-identity-can-read) — this is the whole base state. |
| Push / pull images | `AcrPush` (dev), `AcrPull` (prod) | the registry | One repository in the registry; repository scope needs ABAC mode. Prod never builds: it deploys the digest dev pushed. |
| Write the container app and migration job, start the job | Custom: 9 listed actions, no `delete` | the **app** resource group | The only resource group it can write to. Contains nothing else. |
| Place the app in the environment | Custom: `managedEnvironments/read` + `join/action` | the one Container Apps environment | The app lives in a different resource group from the environment it runs in. |
| Attach a workload identity to the app | Managed Identity Operator | each of the **two** identities, individually | The Azure counterpart of scoping `iam:PassRole` to exact role ARNs. On a resource group it would cover any identity added later. |
| Upload the SPA bundle | Storage Blob Data Contributor | container `$web` | The SPA is half of every release. |

What it does **not** hold: `Owner`, `Contributor`, or `User Access Administrator` at any
scope; any role assignment on the subscription or on the base resource group as a
whole; `Microsoft.Authorization/roleAssignments/write` (it cannot grant itself more);
anything on the VNet, the database, Key Vault, the Front Door profile, or the identities
beyond "attach". The `app` stack's provider sets `resource_provider_registrations =
"none"` because the identity has nothing at subscription scope to register with.

### "Ships a revision and nothing else" — what that honestly means

Shipping a revision is running arbitrary code as the API's runtime identity. So the
deploy identity's effective reach is its own list **plus whatever the workload
identities can reach**. That is why those are narrow too, and why there are two:

| Identity | Can read | Cannot read |
|---|---|---|
| `api` | `database-url` (the non-owner `athlete_app` role), `auth-database-url` (the `athlete_auth` role: users, sessions, password hashes), `session-secret`, `appinsights-connection-string` | the owner connection string, the admin password, the backup key |
| `migrate` | `database-migration-url` (owner), `app-role-password`, `auth-role-password` | the session secret, the admin password secret, the backup key |

Each is `Key Vault Secrets User` on **individual secrets**, not on the vault. The
`migrate` identity does hold the database owner credential, and the deploy identity can
start a job as `migrate`: a compromised pipeline can run SQL as the owner. That is
inherent in "the pipeline runs migrations" and is not hidden by the structure — the
control on it is the GitHub environment's required reviewers, which is configured in
GitHub and is not in this repository.

### What the deploy identity can read

Terraform has no "outputs only" read. Read access to `base` outputs is read access to
the entire `base` state. So the rule for `base` is: **no credential may be stored in
its state.**

- The Postgres admin password, the application role password, and the session secret
  are `ephemeral "random_password"` values passed only to write-only arguments
  (`administrator_password_wo`, `value_wo`). They exist during the apply and are never
  written to state or plan. No human types or sees them in the normal path.
- The SPA storage account has `shared_access_key_enabled = false`, so the account keys
  that *are* in state (as attributes of the resource) are refused by Azure as
  credentials.

What remains readable in `base` state, stated rather than rounded down to "nothing":
the Application Insights connection string and the Log Analytics workspace keys. Both
authorise *sending* telemetry, not reading it; the first is something the app has to be
given anyway.

After the first apply, check it rather than trusting this paragraph:

```bash
terraform -chdir=stacks/dev/base state pull | grep -c 'postgres://'   # expect 0
```

## House rule: every broad scope says why

**Every wildcard, and every scope broader than the single resource it is about, carries
an adjacent comment naming why — ideally the exact permission error that forced it.**

A wildcard with no comment is indistinguishable from one nobody thought about. A
wildcard with a reason can be reviewed, and can be removed when the reason goes away.
The rule applies equally to things that only look like wildcards (URL path patterns in
the edge module say so) so that a grep stays cheap:

```bash
grep -rnE '\*|Contributor|Administrator|Owner' --include='*.tf' modules stacks
```

Every hit should have its reason within a few lines. Today there are no wildcard
actions in any role definition; the broad scopes are: the operator group's role on the
whole state account and on the whole Key Vault, registry-level (not repository-level)
image roles, and container-level (not blob-level) state roles. Each is commented where
it is declared.

None of the comments can yet cite a real permission error, because nothing has been
applied. When the first apply fails with `AuthorizationFailed`, the fix is the one
missing action plus the error text as its comment — not `Contributor`.

## The deploy, in order

The pipeline itself is not written (`.github/workflows/ci.yml` has a commented sketch
that predates this layout). The shape this infrastructure is built for:

1. `azure/login` with OIDC, in a job that declares `environment: <env>`.
2. **dev only:** build, push, record the digest. **prod:** take the digest dev deployed.
3. Give the migration job the *new* image, and nothing else:
   `terraform -chdir=stacks/<env>/app apply -target=module.api.azurerm_container_app_job.migrate -var api_image=<registry>/athlete-api@sha256:…`.
   On a first deploy this creates the job — it lives in this stack, so without this
   step there would be nothing to start — and the API does not exist yet. On every
   later deploy it changes the job's stored image while the API stays on the old one.
   The variable refuses a tag: a tag can be moved after review, a digest cannot.
4. `az containerapp job start` with **no** container flags, and wait for the execution
   to succeed. Postgres has no public endpoint, so the migration has to run inside the
   VNet; and it has to finish before the app changes. If it fails, stop: the API is
   untouched.
5. The same `apply` without `-target`. This is the step that creates or rolls the API.
6. Upload the SPA bundle to `$web`: fingerprinted assets first, `index.html` last, and
   remove superseded assets only on a *later* release. Smoke-check `/api/v1/health`
   through the edge host.
7. Roll back by re-applying the previous digest (a full apply; it moves the job's image
   back too). The schema is untouched, because migrations are additive.

Why not `az containerapp job start --image …`, which would be one step instead of two:
passing any container flag makes the CLI send a whole execution template that
*replaces* the job's rather than patching it. The override would carry the image and
nothing else — no `command`, no secret-backed environment, a container named after the
job — so the execution would run the image's default command without `DATABASE_URL`
instead of running migrations. Updating the stored image and starting the job plain
keeps one definition of the migration container, in Terraform.

`-target` is the cost. Terraform prints a warning on every targeted apply and
documents the flag as being for exceptional use; here it is routine. It needs no
permission beyond the list above (the job write, the environment join and the
`migrate` identity attach are all already there). The alternative that avoids it —
moving the job into its own stack, applied first — is a sixth state container and a
second set of grants, and is not done.

### What the edge caches

Only the fingerprinted build output (`/assets/*`, Vite's default `build.assetsDir`;
`web_fingerprinted_assets_pattern` in the edge module). Those file names change when
their content does, so a cached copy can never be stale. Everything else on the SPA
origin — `index.html`, including when storage serves it for a client-side route, and
any unfingerprinted file at the bundle root — goes through a route with caching off.

The reason is that the storage origin sends no `Cache-Control`, Front Door keeps such a
response for one to three days, and the deploy identity cannot purge. A cached
`index.html` would keep pointing browsers at the previous release's assets for days.
Uncached, a release is live when `index.html` is overwritten. What this does *not*
cover is a browser tab already open on the old shell that lazy-loads a chunk after the
release: that is why step 6 keeps the previous release's assets rather than deleting
them, and that retention is a property of the unwritten pipeline, not of this code.

## Secrets and rotation

Rotation is a number: bump the relevant entry of `secret_versions` in
`stacks/<env>/base/locals.tf` and apply `base`. Terraform cannot see a write-only
value, so the version is the only signal; the bump sends one freshly generated value to
every resource sharing that number in the same apply.

- `session`: apply, then restart the revision (invalidates every session).
- `app_role`: apply, run the migration job (it sets the role's password from
  `app-role-password`), then restart the revision.
- `auth_role`: the same three steps as `app_role`; the migration job sets the
  `athlete_auth` password from `auth-role-password`. Sessions survive: they are rows,
  and only the connection credential changed.
- `postgres_admin`: apply. The server and both secrets holding the password change together.

A hazard worth knowing: because the values are regenerated on every run and only *sent*
on a version bump, replacing one of those resources alone (a taint, an import) gives it
a value the others do not have. Bump the shared version in the same apply.

## Toolchain and static checks

| Tool | Version | Notes |
|---|---|---|
| Terraform | 1.17.2 (`~> 1.17.0`) | Pinned in CI. Needs ≥ 1.11 regardless: write-only arguments and ephemeral values. |
| azurerm | 4.81.0 (`~> 4.81`) | The flat config this replaced was on 4.x; the 5.x upgrade is separate work. |
| random | 3.9.1 (`~> 3.9`) | `base` only. |
| tflint | 0.66.0 + azurerm ruleset 0.33.0 | Config: [`.tflint.hcl`](./.tflint.hcl) |

```bash
cd infra/terraform
terraform fmt -check -recursive
for s in stacks/shared stacks/dev/base stacks/dev/app stacks/prod/base stacks/prod/app; do
  terraform -chdir=$s init -backend=false -input=false -lockfile=readonly
  terraform -chdir=$s validate
  terraform -chdir=$s test          # plans against a mocked provider; no credentials
done
tflint --init && tflint --recursive --config "$(pwd)/.tflint.hcl"
```

`--config` matters: without it, recursive tflint finds no config in each subdirectory,
runs only its bundled rules, and exits 0 with the azurerm ruleset never loaded.

`.terraform.lock.hcl` **is committed** for each stack, with hashes for `linux_amd64`
(CI), `linux_arm64` and `darwin_arm64`, so every machine resolves the same provider
build and CI can use `-lockfile=readonly`. After changing a provider constraint:
`terraform providers lock -platform=linux_amd64 -platform=linux_arm64 -platform=darwin_arm64`.
`.terraform/`, state files and `*.tfvars` are gitignored.

CI runs the same commands in the `terraform` job of `.github/workflows/ci.yml`, with no
cloud credential.

## What has been verified

| Check | Result | What it proves |
|---|---|---|
| `terraform fmt -check -recursive` | clean | Formatting. |
| `terraform validate`, all five stacks | valid | Every argument and block exists in the azurerm 4.81.0 schema with the right type; every reference resolves. |
| `terraform test`, all five stacks + `modules/postgres` | pass | A complete plan-time evaluation against a **mocked** provider: `for_each` keys known at plan, ephemeral values flowing only into write-only arguments, and the two validation rules firing (a tag instead of a digest is refused; HA on a Burstable SKU is refused). |
| `tflint --recursive` with the azurerm ruleset | clean, one annotated exception | Enum values (SKUs and the like) the ruleset knows about; `prevent_destroy` on every data-bearing resource except the SPA bundle, which says why. |

**Not verified, because it cannot be without a subscription:**

- Any `plan` against Azure, any `apply`. A mocked provider accepts anything the schema
  allows; Azure does not.
- **Every permission list.** That the nine actions are enough to deploy, that
  `join/action` is what a cross-resource-group app needs, that long-running-operation
  polling needs nothing at subscription scope — all reasoned, none exercised.
- The `backend "azurerm"` and `terraform_remote_state` blocks. `validate` runs with
  `-backend=false`, so their arguments are unchecked.
- The deploy sequence: that a targeted apply of the job alone succeeds with the deploy
  identity's grants, and that `az containerapp job start` without flags runs the stored
  template. The claim about `--image` replacing the template is read from the Azure
  CLI source, not observed.
- Front Door behaviour: that `/assets/*` wins over `/*` on the same endpoint, and the
  one-to-three-day default lifetime for responses without `Cache-Control` (from the
  Front Door documentation).
- Regional availability in UAE North: zone redundancy for Container Apps and Flexible
  Server, geo-redundant backup to UAE Central, GZRS storage, Front Door features.
- Naming collisions for the globally unique names.
- That the state really contains no credential (see the check above).

## Known gaps

Named rather than quietly omitted. The first three are limits of the design as written,
not merely unfinished work.

| Gap | Detail |
|---|---|
| **The WAF can be bypassed** | Front Door Standard reaches origins over the public internet, so the Container App and the storage endpoint both answer directly on their own hostnames. Closing it needs Front Door Premium (Private Link origins), or the API rejecting requests whose `X-Azure-FDID` is not this profile. Neither is done. |
| **The WAF is a rate limit** | Standard supports custom rules only. Managed rule sets (OWASP, bot) need Premium, roughly ten times the base price. The one rule is a per-IP limit on `/api/`, set loose (3,000/min) because a club can share one NAT address; the number is a guess, not a measurement. |
| **Key Vault, registry and storage have public endpoints** | Access is by Entra ID + RBAC only, but they are reachable from the internet. Private endpoints are not written. Postgres is the one service that is VNet-only. |
| No operator path into the VNet | With Postgres private there is no bastion or VPN for break-glass `psql`. The admin password is in Key Vault; reaching the server with it is unsolved. |
| Nightly dump, restore drill, absence alerts | `STUB` in `stacks/<env>/base/backup.tf`. The backup key and target secret exist; the job that uses them does not. |
| Custom domain | The edge module supports one (`custom_domain` in `locals.tf`, `null` today) with an Azure-managed certificate. The DNS zone and the two records it needs are not managed here. |
| No network security groups | The two subnets rely on delegation and the absence of a public database endpoint. |
| GitHub environment protection | Required reviewers on `prod` are configured in GitHub, not in Terraform. |
| The deploy workflow | Not written; see [The deploy, in order](#the-deploy-in-order). Three things in it are load-bearing and exist only as prose: the targeted apply before the migration, starting the job without container flags, and keeping the previous release's assets in `$web`. No Front Door cache-purge permission is granted, so only content that never needs purging is cached. |
| The SPA shell is not edge-cached or compressed | The price of the row above: `index.html` is fetched from storage on every navigation, uncompressed (Front Door compresses only cached routes). Caching it safely needs a short `Cache-Control` set on the blob at upload, or a purge grant on the profile. |
| A third environment | The proposal describes `staging`; these stacks are `dev` (pre-production on Azure) and `prod`. |

## Decisions worth noting in review

- **No Kubernetes.** At ~2,000 peak concurrent users a control plane and cluster
  upgrades are cost without benefit. Container Apps keeps the deployable a plain
  container, so the same image runs under `docker compose` on one VM — which is the
  answer to "single server" and "budget cut 40%" without a redesign.
- **No stored credentials.** CI authenticates to Azure by OIDC federation; the app
  pulls its image and reads its secrets with a user-assigned managed identity. There is
  no registry password and no connection string in GitHub or in this repository — and,
  with write-only arguments, none in Terraform state either.
- **One registry, one image.** Production deploys the digest dev tested, not a second
  build of the same commit.
- **Production Postgres is General Purpose, not `B_Standard_B2s`.** Azure does not offer
  high availability on the Burstable tier, so "B2s with zone-redundant HA" cannot be
  created. HA was kept and the SKU moved; `modules/postgres` refuses the combination,
  and a test pins that.
- **`prevent_destroy`** on the database, its contents, the Key Vault, its secrets, the
  backup key and the state account. An accidental `terraform destroy` should fail loudly
  rather than succeed quietly. Tearing down `dev` therefore takes a deliberate edit.
- **Liveness does not touch Postgres.** A DB-dependent liveness probe restarts healthy
  containers during a database incident, turning degradation into an outage.
- **Concurrency-based autoscaling, not CPU.** The workload is IO-bound on Postgres, so
  CPU-based scaling under-reacts exactly when requests begin to queue.
- **Same-origin through the edge.** `/api/*` and the SPA share one hostname, so the
  session cookie is first-party with no CORS configuration.
