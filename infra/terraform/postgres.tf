# ---------------------------------------------------------------------------
# PostgreSQL Flexible Server
#
# Backup posture, stated as three tiers because one tier is not a posture:
#   1. PITR within the region   -- everyday mistakes (a bad UPDATE at 14:02)
#   2. Geo-redundant to UAE Central -- loss of the primary region, in-country
#   3. Nightly encrypted logical dump to another country AND another provider,
#      key held in this region's Key Vault (see backup.tf). This is the tier that
#      would have mattered to anyone whose only copy lived in AWS mec1-az2.
# ---------------------------------------------------------------------------

resource "random_password" "postgres_admin" {
  length           = 32
  special          = true
  override_special = "!#%*()-_=+[]"
}

resource "azurerm_key_vault_secret" "postgres_admin" {
  name         = "postgres-admin-password"
  value        = random_password.postgres_admin.result
  key_vault_id = azurerm_key_vault.main.id
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                = "${local.name}-pg"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  version    = "17"
  sku_name   = var.postgres_sku
  storage_mb = var.postgres_storage_mb

  administrator_login    = "athlete_admin"
  administrator_password = random_password.postgres_admin.result

  # 35 days is the maximum; storage for a database this size costs a rounding error,
  # so there is no reason to choose a shorter window.
  backup_retention_days        = 35
  geo_redundant_backup_enabled = var.environment == "prod"

  # Zone-redundant HA survives the loss of one availability zone. It does NOT survive
  # the loss of the region -- a distinction that stopped being academic in March 2026.
  dynamic "high_availability" {
    for_each = var.enable_zone_redundant_ha && var.environment == "prod" ? [1] : []
    content {
      mode = "ZoneRedundant"
    }
  }

  maintenance_window {
    day_of_week  = 5 # Friday
    start_hour   = 22 # local night, outside training hours
    start_minute = 0
  }

  tags = local.tags

  lifecycle {
    # Prevents a plan from proposing a destructive recreate of the production database
    # because of an unrelated attribute drift.
    prevent_destroy = true
  }
}

# The application's own role is created by migration 0001_rls.sql, not here: it is
# NOBYPASSRLS and non-owner by design, and that property belongs with the policies it
# exists to be subject to.
resource "azurerm_postgresql_flexible_server_configuration" "log_min_duration" {
  name      = "log_min_duration_statement"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "1000" # log statements slower than 1s -- the input to the "DB is the bottleneck" answer
}

resource "azurerm_postgresql_flexible_server_configuration" "require_ssl" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "ON"
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "athlete"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_key_vault_secret" "database_url" {
  name = "database-url"
  value = format(
    "postgres://athlete_app@%s:5432/%s?sslmode=require",
    azurerm_postgresql_flexible_server.main.fqdn,
    azurerm_postgresql_flexible_server_database.main.name,
  )
  key_vault_id = azurerm_key_vault.main.id
}
