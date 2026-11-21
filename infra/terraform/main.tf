terraform {
  required_version = ">= 1.9"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state lives in its own storage account, created out-of-band so that
  # destroying this stack cannot destroy the record of what it was.
  # backend "azurerm" {
  #   resource_group_name  = "athlete-tfstate-rg"
  #   storage_account_name = "athletetfstate"
  #   container_name       = "tfstate"
  #   key                  = "prod.terraform.tfstate"
  # }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false # never purge secrets on a destroy
    }
  }
}

locals {
  name   = "${var.project}-${var.environment}"
  suffix = random_string.suffix.result
  tags = merge(var.tags, {
    environment = var.environment
    # Recorded in the infrastructure itself so the residency decision is discoverable
    # from the resource group, not only from a document nobody opens.
    residency = "uae-in-country-primary-and-dr"
  })
}

resource "random_string" "suffix" {
  length  = 5
  special = false
  upper   = false
}

resource "azurerm_resource_group" "main" {
  name     = "${local.name}-rg"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------------------
# Observability. Telemetry stays in-region: logs and traces carry athlete names
# and coach notes, so shipping them to a non-UAE SaaS would break the same
# residency rule that ruled out Clerk/Auth0 for identity.
# ---------------------------------------------------------------------------
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${local.name}-logs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = var.environment == "prod" ? 90 : 30
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "${local.name}-appi"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "Node.JS"
  tags                = local.tags
}

# ---------------------------------------------------------------------------
# Secrets. Also the custody point for the backup encryption key, which is what
# lets the off-provider backup tier hold ciphertext only.
# ---------------------------------------------------------------------------
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "main" {
  name                       = "${var.project}${var.environment}kv${local.suffix}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  enable_rbac_authorization  = true
  purge_protection_enabled   = var.environment == "prod"
  soft_delete_retention_days = 90
  tags                       = local.tags
}

resource "azurerm_container_registry" "main" {
  name                = "${var.project}${var.environment}acr${local.suffix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false # CI authenticates with a federated identity, not a password
  tags                = local.tags
}
