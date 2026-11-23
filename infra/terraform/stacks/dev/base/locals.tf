# Everything that differs between dev and prod in this stack is in the first block of
# this file (plus the container name in backend.tf). Every other file is identical
# across environments: `diff -r stacks/dev/base stacks/prod/base` shows nothing else.
locals {
  project     = "athlete"
  environment = "dev"

  # UAE North (Dubai) deliberately. AWS me-central-1 has been impaired since the
  # 1 March 2026 strikes, with permanent loss of data resident only in mec1-az2, and
  # Google Cloud has no UAE region at all -- so Azure is the only provider currently
  # offering an in-country primary WITH an in-country DR region.
  location    = "uaenorth"
  dr_location = "uaecentral" # Abu Dhabi; the geo-redundant backup pair

  vnet_cidr                  = "10.10.0.0/16"
  container_apps_subnet_cidr = "10.10.0.0/23"
  postgres_subnet_cidr       = "10.10.2.0/27"

  # Pre-production: burstable, single zone, no geo-redundant backup, nothing that
  # cannot be recreated.
  postgres_sku                  = "B_Standard_B2s"
  postgres_storage_mb           = 32768
  postgres_zone_redundant_ha    = false
  postgres_geo_redundant_backup = false
  zone_redundant_environment    = false

  web_replication_type       = "LRS"
  log_retention_days         = 30
  key_vault_purge_protection = false
  custom_domain              = null
  api_rate_limit_per_minute  = 3000
  offsite_backup_bucket_url  = ""

  # Write-only secret versions. Terraform never stores these values, so it cannot see
  # that one changed; bumping a number is how a rotation is requested. Each bump sends a
  # freshly generated value to EVERY resource that shares the number, in one apply.
  secret_versions = {
    postgres_admin = 1
    app_role       = 1
    auth_role      = 1
    session        = 1
  }
}

# Derived; identical in every environment.
locals {
  name   = "${local.project}-${local.environment}"
  suffix = random_string.suffix.result

  # The API's container app is created by the app stack, but its name is fixed here
  # because the edge needs the origin hostname before the app exists.
  api_app_name     = "${local.name}-api"
  migrate_job_name = "${local.name}-migrate"

  operator_group_object_id     = data.terraform_remote_state.shared.outputs.operator_group_object_id
  deploy_identity_principal_id = data.terraform_remote_state.shared.outputs.deploy_identity_principal_ids[local.environment]

  tags = {
    workload    = "athlete-platform"
    managed_by  = "terraform"
    environment = local.environment
    # Recorded in the infrastructure itself so the residency decision is discoverable
    # from the resource group, not only from a document nobody opens.
    residency = "uae-in-country-primary-and-dr"
  }
}
