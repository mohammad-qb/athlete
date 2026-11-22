# A plan against a MOCKED azurerm provider: no credentials, no subscription, no API
# call. It proves the configuration evaluates end to end -- references resolve,
# for_each keys are known at plan time, validation rules fire -- which `validate`
# alone does not. It proves nothing about what Azure would accept.

mock_provider "azurerm" {}

override_data {
  target = data.terraform_remote_state.base
  values = {
    outputs = {
      app_resource_group_name      = "athlete-dev-app-rg"
      location                     = "uaenorth"
      container_app_environment_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-dev-base-rg/providers/Microsoft.App/managedEnvironments/athlete-dev-cae"
      api_app_name                 = "athlete-dev-api"
      migrate_job_name             = "athlete-dev-migrate"
      registry_login_server        = "athleteplatformacr.azurecr.io"
      api_identity_id              = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-dev-base-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/athlete-dev-api-id"
      migrate_identity_id          = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-dev-base-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/athlete-dev-migrate-id"
      app_base_url                 = "https://athlete-dev-abcde.z01.azurefd.net"
      auth_trusted_proxies         = ["147.243.0.0/16", "2a01:111:2050::/44"]
      api_secrets = {
        "database-url" = { env_name = "DATABASE_URL", key_vault_secret_id = "https://athletedevkvabcde.vault.azure.net/secrets/database-url" }
      }
      migrate_secrets = {
        "database-migration-url" = { env_name = "DATABASE_URL", key_vault_secret_id = "https://athletedevkvabcde.vault.azure.net/secrets/database-migration-url" }
      }
    }
  }
}

run "digest_ok" {
  command = plan
  variables {
    api_image = "athleteplatformacr.azurecr.io/athlete-api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}

# A tag can be re-pointed after review; the stack refuses one.
run "tag_rejected" {
  command = plan
  variables {
    api_image = "athleteplatformacr.azurecr.io/athlete-api:latest"
  }
  expect_failures = [var.api_image]
}
