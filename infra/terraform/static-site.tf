# ---------------------------------------------------------------------------
# The SPA: static files, not a second runtime.
#
# This is why production is ONE Node process. Choosing a Vite SPA over SSR was a
# deployment decision as much as a frontend one: an authenticated internal platform
# gains nothing from server rendering (no SEO, no public pages), so a second Node
# service would have been pure cost and pure operational surface.
# ---------------------------------------------------------------------------

resource "azurerm_storage_account" "web" {
  name                            = "${var.project}${var.environment}web${local.suffix}"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = var.environment == "prod" ? "GZRS" : "LRS"
  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"
  tags                            = local.tags

  static_website {
    index_document     = "index.html"
    # SPA routing: unknown paths must return the app shell, not a 404.
    error_404_document = "index.html"
  }
}

# ---------------------------------------------------------------------------
# STUB -- NOT YET WRITTEN. Declared here so the gap is visible rather than implied.
#
# Front Door Standard in front of the storage account, for TLS on a custom domain,
# WAF, and caching of the static bundle. Roughly USD 35/month base plus traffic, and
# the first thing to swap for plain Blob static hosting behind Cloudflare under the
# "budget reduced 40%" scenario.
#
#   resource "azurerm_cdn_frontdoor_profile" "main"      { ... }
#   resource "azurerm_cdn_frontdoor_endpoint" "web"      { ... }
#   resource "azurerm_cdn_frontdoor_origin_group" "web"  { ... }
#   resource "azurerm_cdn_frontdoor_origin" "web_blob"   { ... }
#   resource "azurerm_cdn_frontdoor_route" "web"         { ... }
#   resource "azurerm_cdn_frontdoor_firewall_policy" "main" { ... }
# ---------------------------------------------------------------------------
