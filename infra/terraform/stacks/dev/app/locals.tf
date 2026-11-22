# Everything that differs between dev and prod in this stack is in this file (plus the
# container names in backend.tf and data.tf).
locals {
  environment = "dev"

  # Pre-production: one replica, no redundancy to pay for.
  api_min_replicas = 1
  api_max_replicas = 2

  base = data.terraform_remote_state.base.outputs

  tags = {
    workload    = "athlete-platform"
    managed_by  = "terraform"
    environment = local.environment
    residency   = "uae-in-country-primary-and-dr"
  }
}
