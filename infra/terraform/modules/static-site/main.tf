# ---------------------------------------------------------------------------
# The SPA: static files, not a second runtime.
#
# This is why production is ONE Node process. Choosing a Vite SPA over SSR was a
# deployment decision as much as a frontend one: an authenticated internal platform
# gains nothing from server rendering (no SEO, no public pages), so a second Node
# service would have been pure cost and pure operational surface.
# ---------------------------------------------------------------------------

# No prevent_destroy, on purpose: the only data here is the SPA bundle, which every
# build reproduces. Protecting it would make a teardown harder and protect nothing.
# tflint-ignore: azurerm_resources_missing_prevent_destroy
resource "azurerm_storage_account" "this" {
  name                            = var.name
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = var.replication_type
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"

  # Account keys still exist (and sit in the base state as attributes of this
  # resource), but with this off Azure refuses them as credentials. That matters
  # because the deploy identity can read the base state: without this line, reading
  # state would be a path to full control of the account. Uploads use Entra ID + RBAC.
  shared_access_key_enabled = false

  tags = var.tags
}

resource "azurerm_storage_account_static_website" "this" {
  storage_account_id = azurerm_storage_account.this.id
  index_document     = "index.html"
  # SPA routing: unknown paths must return the app shell, not a 404.
  error_404_document = "index.html"
}
