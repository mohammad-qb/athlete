# ---------------------------------------------------------------------------
# Secrets. Also the custody point for the backup encryption key, which is what
# lets the off-provider backup tier hold ciphertext only.
#
# Every secret whose value is a credential is written through `value_wo`, so the value
# reaches Key Vault without being stored in this stack's state. That is load-bearing,
# not tidiness: the deploy identity can read this state (see the README).
#
# `prevent_destroy` on each secret: a rotation is an in-place update (a new secret
# version), never a destroy, so the only plan this blocks is one that would leave a
# running workload pointing at a secret that no longer exists.
# ---------------------------------------------------------------------------

resource "azurerm_key_vault" "main" {
  name                       = "${local.project}${local.environment}kv${local.suffix}"
  location                   = azurerm_resource_group.base.location
  resource_group_name        = azurerm_resource_group.base.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = local.key_vault_purge_protection
  soft_delete_retention_days = 90
  tags                       = local.tags

  lifecycle {
    # Holds the backup key. Soft delete makes a deleted vault recoverable for 90 days;
    # this makes the plan that would delete it fail first.
    prevent_destroy = true
  }
}

# Broad role, deliberately: Key Vault Administrator is every data-plane action on this
# one vault. The operator group applies this stack, which creates secrets AND the
# backup key, and is the break-glass reader of the admin password; Secrets Officer +
# Crypto Officer would be the same people holding the same reach under two names.
# Owner on the subscription does not include any of it -- without this assignment the
# first apply fails on the first secret with 403 ForbiddenByRbac.
resource "azurerm_role_assignment" "operators_key_vault" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = local.operator_group_object_id
  principal_type       = "Group"
}

locals {
  database_host = module.postgres.fqdn
  database_name = module.postgres.database_name
}

# Read by: the API.
resource "azurerm_key_vault_secret" "database_url" {
  name         = "database-url"
  key_vault_id = azurerm_key_vault.main.id
  # The application role: non-owner, NOBYPASSRLS. The API refuses to boot on anything
  # more privileged.
  value_wo = format(
    "postgres://athlete_app:%s@%s:5432/%s?sslmode=require",
    ephemeral.random_password.app_role.result, local.database_host, local.database_name,
  )
  value_wo_version = local.secret_versions.app_role

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}

# Read by: the API, and used by better-auth alone.
resource "azurerm_key_vault_secret" "auth_database_url" {
  name         = "auth-database-url"
  key_vault_id = azurerm_key_vault.main.id
  # The auth role: users, sessions and password hashes, and nothing tenant-owned. A
  # second role rather than a wider `athlete_app`, so a statement running as the
  # application role still cannot read a credential.
  value_wo = format(
    "postgres://athlete_auth:%s@%s:5432/%s?sslmode=require",
    ephemeral.random_password.auth_role.result, local.database_host, local.database_name,
  )
  value_wo_version = local.secret_versions.auth_role

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}

# Read by: the API. better-auth signs session cookies with it.
resource "azurerm_key_vault_secret" "session_secret" {
  name             = "session-secret"
  key_vault_id     = azurerm_key_vault.main.id
  value_wo         = ephemeral.random_password.session.result
  value_wo_version = local.secret_versions.session

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}

ephemeral "random_password" "session" {
  length  = 48
  special = false
}

# Read by: the API. Not write-only, because it cannot be: the connection string is an
# attribute of the Application Insights resource and is in this state regardless. It
# authorises sending telemetry, not reading it.
resource "azurerm_key_vault_secret" "appinsights_connection_string" {
  name         = "appinsights-connection-string"
  key_vault_id = azurerm_key_vault.main.id
  value        = azurerm_application_insights.main.connection_string

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}

# Read by: the migration job only. Migrations run as the owner -- a different identity
# from the one that serves requests, which is the whole privilege split.
resource "azurerm_key_vault_secret" "database_migration_url" {
  name         = "database-migration-url"
  key_vault_id = azurerm_key_vault.main.id
  value_wo = format(
    "postgres://athlete_admin:%s@%s:5432/%s?sslmode=require",
    ephemeral.random_password.postgres_admin.result, local.database_host, local.database_name,
  )
  value_wo_version = local.secret_versions.postgres_admin

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}

# Read by: the migration job only. The migrations create `athlete_app` and set its
# password from APP_ROLE_PASSWORD; the same value is embedded in database-url above.
resource "azurerm_key_vault_secret" "app_role_password" {
  name             = "app-role-password"
  key_vault_id     = azurerm_key_vault.main.id
  value_wo         = ephemeral.random_password.app_role.result
  value_wo_version = local.secret_versions.app_role

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}

# Read by: the migration job only. Likewise for `athlete_auth` and AUTH_ROLE_PASSWORD;
# the same value is embedded in auth-database-url above.
resource "azurerm_key_vault_secret" "auth_role_password" {
  name             = "auth-role-password"
  key_vault_id     = azurerm_key_vault.main.id
  value_wo         = ephemeral.random_password.auth_role.result
  value_wo_version = local.secret_versions.auth_role

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}

# Read by: operators only (break-glass). No workload identity is granted this secret.
resource "azurerm_key_vault_secret" "postgres_admin_password" {
  name             = "postgres-admin-password"
  key_vault_id     = azurerm_key_vault.main.id
  value_wo         = ephemeral.random_password.postgres_admin.result
  value_wo_version = local.secret_versions.postgres_admin

  depends_on = [azurerm_role_assignment.operators_key_vault]

  lifecycle {
    prevent_destroy = true
  }
}
