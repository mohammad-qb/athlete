# A plan against a MOCKED azurerm provider: no credentials, no subscription, no API
# call. It proves the configuration evaluates end to end -- references resolve,
# for_each keys are known at plan time, validation rules fire -- which `validate`
# alone does not. It proves nothing about what Azure would accept.

mock_provider "azurerm" {}

override_data {
  target = data.terraform_remote_state.base
  values = {
    outputs = {
      app_resource_group_name      = "athlete-prod-app-rg"
      location                     = "uaenorth"
      container_app_environment_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-prod-base-rg/providers/Microsoft.App/managedEnvironments/athlete-prod-cae"
      api_app_name                 = "athlete-prod-api"
      migrate_job_name             = "athlete-prod-migrate"
      registry_login_server        = "athleteplatformacr.azurecr.io"
      api_identity_id              = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-prod-base-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/athlete-prod-api-id"
      migrate_identity_id          = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-prod-base-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/athlete-prod-migrate-id"
      api_secrets = {
        "database-url" = { env_name = "DATABASE_URL", key_vault_secret_id = "https://athleteprodkvabcde.vault.azure.net/secrets/database-url" }
      }
      migrate_secrets = {
        "database-migration-url" = { env_name = "DATABASE_URL", key_vault_secret_id = "https://athleteprodkvabcde.vault.azure.net/secrets/database-migration-url" }
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
