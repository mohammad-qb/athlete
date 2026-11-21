# Infrastructure

Terraform for the Azure UAE North deployment.

## Honest scope

This is the **core** of the deployment, not all of it. What is here has been written
carefully; what is missing is marked `STUB` in the file where it belongs, so the gaps
are visible rather than implied:

| Present | Stubbed (and where) |
|---|---|
| Resource group, tags, naming | Front Door + WAF (`static-site.tf`) |
| Log Analytics + Application Insights | Nightly dump job (`backup.tf`) |
| Key Vault, RBAC, backup key | Scheduled restore drill (`backup.tf`) |
| Container Registry (no admin user) | Absence alert rules (`backup.tf`) |
| Postgres Flexible Server + HA + geo-backup | Private endpoint / VNet integration |
| Container App + identity + probes + scaling | Custom domain and certificate |
| Storage static website for the SPA | Non-prod environment definitions |

**Not applied against a live subscription, and not `terraform validate`d** — no Azure
credentials and no Terraform binary were available while writing it. Treat it as a
reviewed design artifact, and expect provider-schema corrections on first `plan`.
Saying so is cheaper than being caught by it.

## Usage

```bash
terraform init
terraform plan  -var="api_image=<acr>.azurecr.io/athlete-api:<sha>"
terraform apply -var="api_image=<acr>.azurecr.io/athlete-api:<sha>"
```

## Decisions worth noting in review

- **No Kubernetes.** At ~2,000 peak concurrent users a control plane and cluster
  upgrades are cost without benefit. Container Apps keeps the deployable a plain
  container, so the same image runs under `docker compose` on one VM — which is the
  answer to "single server" and "budget cut 40%" without a redesign.
- **No stored credentials.** CI authenticates to Azure by OIDC federation; the app
  pulls its image and reads its secrets with a user-assigned managed identity. There is
  no registry password and no connection string in GitHub or in this repository.
- **`prevent_destroy`** on the database, the database's contents and the backup key.
  An accidental `terraform destroy` should fail loudly rather than succeed quietly.
- **Liveness does not touch Postgres.** A DB-dependent liveness probe restarts healthy
  containers during a database incident, turning degradation into an outage.
- **Concurrency-based autoscaling, not CPU.** The workload is IO-bound on Postgres, so
  CPU-based scaling under-reacts exactly when requests begin to queue.
