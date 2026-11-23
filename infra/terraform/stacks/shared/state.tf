# ---------------------------------------------------------------------------
# Terraform state. Its own resource group's worth of care: destroying any other stack
# must not be able to destroy the record of what that stack was.
# ---------------------------------------------------------------------------

resource "azurerm_storage_account" "state" {
  name                     = var.state_storage_account_name
  resource_group_name      = azurerm_resource_group.shared.name
  location                 = azurerm_resource_group.shared.location
  account_tier             = "Standard"
  account_replication_type = "GZRS"
  min_tls_version          = "TLS1_2"

  allow_nested_items_to_be_public = false
  # No account keys as credentials: every reader and writer of state is a named
  # principal with a role on one container.
  shared_access_key_enabled = false

  blob_properties {
    versioning_enabled = true # a bad apply or a corrupt write is recoverable

    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }

  tags = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_storage_container" "state" {
  for_each = local.state_containers

  name                  = each.key
  storage_account_id    = azurerm_storage_account.state.id
  container_access_type = "private"

  lifecycle {
    prevent_destroy = true
  }
}

# Broad scope, deliberately: the whole account, i.e. every stack's state. The operator
# group applies `shared` and both `base` stacks and is the break-glass for `app`, so it
# needs all five containers; five per-container assignments would say the same thing
# with more to keep in step.
resource "azurerm_role_assignment" "operators_state" {
  scope                = azurerm_storage_account.state.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.operator_group_object_id
  principal_type       = "Group"
}
