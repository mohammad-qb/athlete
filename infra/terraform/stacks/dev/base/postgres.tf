# Generated at apply time and never written to state or plan: `ephemeral` values exist
# only for the duration of the run, and the arguments that receive them are write-only.
# No human ever types or sees either password in the normal path.
ephemeral "random_password" "postgres_admin" {
  length  = 48
  special = false # alphanumeric, so the value is safe inside a connection URL unescaped
}

ephemeral "random_password" "app_role" {
  length  = 48
  special = false
}

# `athlete_auth`: the role better-auth connects as. Its own password, so that rotating
# one service role's credential never touches the other.
ephemeral "random_password" "auth_role" {
  length  = 48
  special = false
}

module "postgres" {
  source = "../../../modules/postgres"

  name                = "${local.name}-pg-${local.suffix}"
  resource_group_name = azurerm_resource_group.base.name
  location            = azurerm_resource_group.base.location

  sku_name             = local.postgres_sku
  storage_mb           = local.postgres_storage_mb
  zone_redundant_ha    = local.postgres_zone_redundant_ha
  geo_redundant_backup = local.postgres_geo_redundant_backup

  delegated_subnet_id = azurerm_subnet.postgres.id
  private_dns_zone_id = azurerm_private_dns_zone.postgres.id

  administrator_login            = "athlete_admin"
  administrator_password         = ephemeral.random_password.postgres_admin.result
  administrator_password_version = local.secret_versions.postgres_admin

  database_name = "athlete"
  tags          = local.tags

  # The server cannot register its name until the zone is linked to the VNet.
  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}
