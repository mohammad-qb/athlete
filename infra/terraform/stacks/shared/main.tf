# ---------------------------------------------------------------------------
# Cross-environment resources: Terraform state, the image registry, and the CI deploy
# identities. Applied by a human, rarely.
#
# The registry is shared so that production runs the exact image digest dev tested,
# rather than a second build of the same commit.
# ---------------------------------------------------------------------------

locals {
  tags = {
    workload   = "athlete-platform"
    managed_by = "terraform"
    stack      = "shared"
    # Recorded in the infrastructure itself so the residency decision is discoverable
    # from the resource group, not only from a document nobody opens.
    residency = "uae-in-country-primary-and-dr"
  }

  # One state container per stack, because blob RBAC stops at the container: a role
  # cannot be scoped to one blob key without an ABAC condition. With one stack per
  # container, "its own state key" and "one container" are the same boundary.
  state_containers = toset(["shared", "dev-base", "dev-app", "prod-base", "prod-app"])

  deploy_environments = {
    dev = {
      # dev builds and pushes the image.
      registry_role = "AcrPush"
    }
    prod = {
      # prod deploys the digest dev already pushed; it never builds, so it never pushes.
      # Pull is enough to confirm the digest exists before the deploy starts.
      registry_role = "AcrPull"
    }
  }
}

resource "azurerm_resource_group" "shared" {
  name     = "athlete-shared-rg"
  location = var.location
  tags     = local.tags
}

resource "azurerm_container_registry" "main" {
  name                = var.registry_name
  resource_group_name = azurerm_resource_group.shared.name
  location            = azurerm_resource_group.shared.location
  sku                 = "Basic"
  admin_enabled       = false # CI authenticates with a federated identity, not a password
  tags                = local.tags
}
