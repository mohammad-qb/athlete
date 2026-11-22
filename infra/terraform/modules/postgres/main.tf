# ---------------------------------------------------------------------------
# PostgreSQL Flexible Server
#
# Backup posture, stated as three tiers because one tier is not a posture:
#   1. PITR within the region   -- everyday mistakes (a bad UPDATE at 14:02)
#   2. Geo-redundant to UAE Central -- loss of the primary region, in-country
#   3. Nightly encrypted logical dump to another country AND another provider,
#      key held in this region's Key Vault (see stacks/<env>/base/backup.tf). This is
#      the tier that would have mattered to anyone whose only copy lived in AWS mec1-az2.
# ---------------------------------------------------------------------------

resource "azurerm_postgresql_flexible_server" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location

  version    = "17"
  sku_name   = var.sku_name
  storage_mb = var.storage_mb

  # VNet-integrated: reachable only from the delegated subnet's VNet. There is no
  # firewall rule to get wrong because there is no public endpoint to open.
  delegated_subnet_id           = var.delegated_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  public_network_access_enabled = false

  administrator_login = var.administrator_login
  # Write-only: the provider sends the value to Azure and does not persist it, so the
  # base state -- which the deploy identity can read -- never holds the admin password.
  administrator_password_wo         = var.administrator_password
  administrator_password_wo_version = var.administrator_password_version

  # 35 days is the maximum; storage for a database this size costs a rounding error,
  # so there is no reason to choose a shorter window.
  backup_retention_days        = 35
  geo_redundant_backup_enabled = var.geo_redundant_backup

  # Zone-redundant HA survives the loss of one availability zone. It does NOT survive
  # the loss of the region -- a distinction that stopped being academic in March 2026.
  dynamic "high_availability" {
    for_each = var.zone_redundant_ha ? [1] : []
    content {
      mode = "ZoneRedundant"
    }
  }

  maintenance_window {
    day_of_week  = 5  # Friday
    start_hour   = 22 # local night, outside training hours
    start_minute = 0
  }

  tags = var.tags

  lifecycle {
    # Prevents a plan from proposing a destructive recreate of the database because of
    # an unrelated attribute drift. Applies to dev too: `lifecycle` cannot be
    # parameterised, and a dev teardown that needs a deliberate edit is a fair price.
    prevent_destroy = true

    # Azure picks the primary zone, and after an HA failover primary and standby swap.
    # Without this, the next plan proposes moving the server back.
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

# The application's own role is created by the migrations, not here: it is NOBYPASSRLS
# and non-owner by design, and that property belongs with the policies it exists to be
# subject to.
resource "azurerm_postgresql_flexible_server_configuration" "log_min_duration" {
  name      = "log_min_duration_statement"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "1000" # log statements slower than 1s -- the input to the "DB is the bottleneck" answer
}

resource "azurerm_postgresql_flexible_server_configuration" "require_ssl" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "ON"
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"

  lifecycle {
    prevent_destroy = true
  }
}
