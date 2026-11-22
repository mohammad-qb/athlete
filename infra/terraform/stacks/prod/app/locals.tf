# Everything that differs between dev and prod in this stack is in this file (plus the
# container names in backend.tf and data.tf).
locals {
  environment = "prod"

  # min 2 so a revision swap is not a cold start and a single node failure is not an
  # outage. Cheap at this size; the first lever to pull on cost.
  api_min_replicas = 2
  api_max_replicas = 6

  base = data.terraform_remote_state.base.outputs

  tags = {
    workload    = "athlete-platform"
    managed_by  = "terraform"
    environment = local.environment
    residency   = "uae-in-country-primary-and-dr"
  }
}
