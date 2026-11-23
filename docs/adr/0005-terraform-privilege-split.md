# 5. Terraform split by who applies it; a deploy identity that cannot touch IAM

- **Status:** Accepted. **Never applied**: there is no Azure subscription.
- **Date:** 2026-11-22

## Context

The infrastructure was one flat Terraform configuration, which means one identity that
applies everything. If CI applies it, the pipeline can create role assignments, open
the network and read the database owner's credential, so a compromised workflow or a
malicious pull request owns the environment. The proposal claimed a privilege split
that the code did not express.

## Decision

> **Stacks are divided by who applies them. Humans apply everything that decides who
> can reach what. CI applies the container revision, with an identity that can do that
> and nothing else.**

- **Layout:** reusable `modules/{container-app,postgres,static-site,edge}`, and
  independent roots `stacks/shared`, `stacks/<env>/base`, `stacks/<env>/app`, each with
  its own state container.
- **`shared` and `base` are applied by a named operator group**: the deploy
  identities, network, Postgres, Key Vault and secrets, workload identities, and the
  deploy identity's own grants. **`app` is applied by CI**: the container app and the
  migration job.
- **The deploy identity** is a user-assigned managed identity per environment with one
  federated credential whose subject is exactly one repository and one GitHub
  environment. No client secret exists. Its grants: its own state container; read on
  the base state; push (dev) or pull (prod) on the registry; a custom role of nine
  listed actions with no `delete` on the app resource group; `join` on the one
  Container Apps environment; Managed Identity Operator on each of the two workload
  identities individually; write on the SPA's `$web` container. It holds no
  role-assignment write, so it cannot grant itself more.
- **No credential in state.** "Read base outputs" is read access to the whole base
  state, so the three generated passwords are ephemeral values passed to write-only
  arguments and never stored.
- **House rule:** every wildcard, and every scope broader than the single resource it
  is about, carries an adjacent comment naming why — ideally the permission error that
  forced it.
- **Migrations run as a Container Apps Job**, started by the pipeline, because
  Postgres is VNet-only and a hosted runner cannot reach it.

## Options considered

- **One configuration applied by CI with Contributor** — simplest, and the pipeline
  becomes the most privileged principal in the system.
- **One configuration applied by humans only** — safe, and every deploy waits for a
  person; it would be bypassed within a month.
- **A state key per stack in one container** — the plan's wording. Blob RBAC stops at
  the container, so "its own state key" without ABAC conditions means its own
  container.
- **Front Door Premium** — closes the two edge gaps below, at roughly ten times the
  base price. Not chosen for a platform of this size; the gaps are named instead.

## Consequences

- **Good:** the privilege boundary is reviewable as code, in two files.
- **The honest limit:** shipping a revision is running arbitrary code as the API's
  runtime identity, and the pipeline can start a job that runs as the database owner.
  So the workload identities are narrow too — per-secret access, two identities — and
  the remaining control is the GitHub environment's required reviewers, which is
  configured in GitHub and is not in this repository.
- **Cost:** a deploy is two applies with a routine `-target` on the first (give the
  migration job the new image, run it, then roll the API), and Terraform warns on
  every targeted apply.
- **Unverified, all of it that touches Azure:** `fmt`, `validate`, `terraform test`
  against a mocked provider and `tflint` pass. No plan or apply has ever run. Every
  permission list is reasoned, not exercised; expect corrections on the first apply.
- **Found by writing it:** Azure offers no high availability on Burstable Postgres
  SKUs, so the proposal's "B2s with zone-redundant HA" could not exist. Production
  moved to the smallest General Purpose size and the cost tables were redone
  ([05](../05-deployment.md#indicative-monthly-cost)).
- **Known gaps, named:** Front Door Standard has no managed WAF rules and no private
  origins, so the WAF is one rate limit and origins answer directly; Key Vault,
  registry and storage have public endpoints; no operator path into the VNet; the
  backup job, restore drill and deploy workflow are not written. Full list:
  [`infra/terraform/README.md`](../../infra/terraform/README.md#known-gaps).
