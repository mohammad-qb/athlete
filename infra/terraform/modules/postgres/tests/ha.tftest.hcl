# Mocked provider; see stacks/*/tests for what that does and does not prove.
#
# The proposal's original sizing asked for B_Standard_B2s WITH zone-redundant HA, which
# Azure does not offer. This pins the module's refusal of that combination.

mock_provider "azurerm" {}

variables {
  name                           = "athlete-test-pg"
  resource_group_name            = "athlete-test-rg"
  location                       = "uaenorth"
  storage_mb                     = 32768
  geo_redundant_backup           = false
  delegated_subnet_id            = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-test-rg/providers/Microsoft.Network/virtualNetworks/v/subnets/postgres"
  private_dns_zone_id            = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-test-rg/providers/Microsoft.Network/privateDnsZones/athlete-test.private.postgres.database.azure.com"
  administrator_login            = "athlete_admin"
  administrator_password         = "not-a-real-password"
  administrator_password_version = 1
  database_name                  = "athlete"
  tags                           = {}
}

run "burstable_with_ha_rejected" {
  command = plan

  variables {
    sku_name          = "B_Standard_B2s"
    zone_redundant_ha = true
  }

  expect_failures = [var.zone_redundant_ha]
}

run "burstable_without_ha_accepted" {
  command = plan

  variables {
    sku_name          = "B_Standard_B2s"
    zone_redundant_ha = false
  }
}

run "general_purpose_with_ha_accepted" {
  command = plan

  variables {
    sku_name          = "GP_Standard_D2ds_v4"
    zone_redundant_ha = true
  }
}
