# ---------------------------------------------------------------------------
# Workload identities. Created here, by a human; the deploy identity can attach them
# to a container app (deploy-access.tf) but cannot create one or change what one can
# reach.
#
# Two identities, so that code serving requests can never read the owner credential:
#   api      -> database-url (athlete_app), session-secret, telemetry connection string
#   migrate  -> database-migration-url (owner), app-role-password
# Neither can read postgres-admin-password or use the backup key.
# ---------------------------------------------------------------------------

resource "azurerm_user_assigned_identity" "api" {
  name                = "${local.name}-api-id"
  location            = azurerm_resource_group.base.location
  resource_group_name = azurerm_resource_group.base.name
  tags                = local.tags
}

resource "azurerm_user_assigned_identity" "migrate" {
  name                = "${local.name}-migrate-id"
  location            = azurerm_resource_group.base.location
  resource_group_name = azurerm_resource_group.base.name
  tags                = local.tags
}

locals {
  workload_identities = {
    api     = azurerm_user_assigned_identity.api.principal_id
    migrate = azurerm_user_assigned_identity.migrate.principal_id
  }

  # Secret-scoped, not vault-scoped: "Key Vault Secrets User" on the vault would let
  # either identity read every secret in it, including the other's.
  secret_readers = {
    "api/database-url"                  = { identity = "api", scope = azurerm_key_vault_secret.database_url.resource_versionless_id }
    "api/session-secret"                = { identity = "api", scope = azurerm_key_vault_secret.session_secret.resource_versionless_id }
    "api/appinsights-connection-string" = { identity = "api", scope = azurerm_key_vault_secret.appinsights_connection_string.resource_versionless_id }
    "migrate/database-migration-url"    = { identity = "migrate", scope = azurerm_key_vault_secret.database_migration_url.resource_versionless_id }
    "migrate/app-role-password"         = { identity = "migrate", scope = azurerm_key_vault_secret.app_role_password.resource_versionless_id }
  }
}

resource "azurerm_role_assignment" "secret_reader" {
  for_each = local.secret_readers

  scope                = each.value.scope
  role_definition_name = "Key Vault Secrets User"
  principal_id         = local.workload_identities[each.value.identity]
  principal_type       = "ServicePrincipal"
}

# Registry scope, not repository scope: the same reasoning as the deploy identity's
# registry role in stacks/shared/github-oidc.tf -- one repository in the registry, and
# repository-scoped roles need ABAC repository-permissions mode.
resource "azurerm_role_assignment" "image_pull" {
  for_each = local.workload_identities

  scope                = data.terraform_remote_state.shared.outputs.registry_id
  role_definition_name = "AcrPull"
  principal_id         = each.value
  principal_type       = "ServicePrincipal"
}
