# ---------------------------------------------------------------------------
# Base: identity, network, database, secrets, edge. Applied by a human.
#
# Two resource groups, and the split is the privilege boundary: everything here lives
# in `base`; the `app` group is created empty and is the only place the deploy identity
# can write. A role scoped to a resource group cannot reach into its neighbour.
# ---------------------------------------------------------------------------

resource "random_string" "suffix" {
  length  = 5
  special = false
  upper   = false
}

resource "azurerm_resource_group" "base" {
  name     = "${local.name}-base-rg"
  location = local.location
  tags     = local.tags
}

resource "azurerm_resource_group" "app" {
  name     = "${local.name}-app-rg"
  location = local.location
  tags     = local.tags
}

# ---------------------------------------------------------------------------
# Observability. Telemetry stays in-region: logs and traces carry athlete names
# and coach notes, so shipping them to a non-UAE SaaS would break the same
# residency rule that ruled out Clerk/Auth0 for identity.
# ---------------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${local.name}-logs"
  location            = azurerm_resource_group.base.location
  resource_group_name = azurerm_resource_group.base.name
  sku                 = "PerGB2018"
  retention_in_days   = local.log_retention_days
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "${local.name}-appi"
  location            = azurerm_resource_group.base.location
  resource_group_name = azurerm_resource_group.base.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "Node.JS"
  tags                = local.tags
}

# The environment is the network attachment point, so it belongs to base. The deploy
# identity may place an app in it (deploy-access.tf) but cannot change it.
resource "azurerm_container_app_environment" "main" {
  name                       = "${local.name}-cae"
  location                   = azurerm_resource_group.base.location
  resource_group_name        = azurerm_resource_group.base.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  infrastructure_subnet_id       = azurerm_subnet.container_apps.id
  internal_load_balancer_enabled = false # Front Door Standard needs a public origin
  zone_redundancy_enabled        = local.zone_redundant_environment

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  tags = local.tags

  lifecycle {
    # Azure names the managed infrastructure resource group itself.
    ignore_changes = [infrastructure_resource_group_name]
  }
}

module "static_site" {
  source = "../../../modules/static-site"

  name                = "${local.project}${local.environment}web${local.suffix}"
  resource_group_name = azurerm_resource_group.base.name
  location            = azurerm_resource_group.base.location
  replication_type    = local.web_replication_type
  tags                = local.tags
}

module "edge" {
  source = "../../../modules/edge"

  name                = local.name
  resource_group_name = azurerm_resource_group.base.name
  web_origin_host     = module.static_site.web_host
  # A container app's stable hostname is <app name>.<environment default domain>, so
  # the origin can be declared before the app stack has ever been applied.
  api_origin_host           = "${local.api_app_name}.${azurerm_container_app_environment.main.default_domain}"
  custom_domain             = local.custom_domain
  api_rate_limit_per_minute = local.api_rate_limit_per_minute
  tags                      = local.tags
}
