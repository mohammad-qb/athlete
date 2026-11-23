# ---------------------------------------------------------------------------
# Edge: Front Door Standard in front of both origins.
#
# One hostname: /api/* to the Container App, everything else to the SPA bundle (split
# into a cached route for fingerprinted assets and an uncached catch-all for the HTML
# shell). Same-origin is the reason this is more than a CDN for static files -- the
# session cookie stays first-party with no CORS and no SameSite=None.
#
# Standard, not Premium, on cost (~USD 35/month base against ~USD 330). What Standard
# does NOT include, stated because "Front Door + WAF" otherwise overclaims:
#   - Managed rule sets (OWASP / bot). Standard runs custom rules only; the one below is
#     a rate limit. Managed rules are the first thing Premium would buy.
#   - Private Link origins. Both origins stay publicly reachable, so the WAF can be
#     bypassed by calling an origin hostname directly. See the README's "Known gaps".
# ---------------------------------------------------------------------------

locals {
  sku = "Standard_AzureFrontDoor"
}

resource "azurerm_cdn_frontdoor_profile" "this" {
  name                = "${var.name}-fd"
  resource_group_name = var.resource_group_name
  sku_name            = local.sku
  tags                = var.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "this" {
  name                     = var.name
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  tags                     = var.tags
}

# No health_probe blocks: each group has a single origin, so a probe cannot route
# around a failure -- it would only add a steady stream of requests to the origin.
resource "azurerm_cdn_frontdoor_origin_group" "web" {
  name                     = "web"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id

  load_balancing {}
}

resource "azurerm_cdn_frontdoor_origin_group" "api" {
  name                     = "api"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id

  load_balancing {}
}

resource "azurerm_cdn_frontdoor_origin" "web" {
  name                           = "web-static-site"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.web.id
  enabled                        = true
  host_name                      = var.web_origin_host
  origin_host_header             = var.web_origin_host
  https_port                     = 443
  certificate_name_check_enabled = true
}

resource "azurerm_cdn_frontdoor_origin" "api" {
  name                           = "api-container-app"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.api.id
  enabled                        = true
  host_name                      = var.api_origin_host
  origin_host_header             = var.api_origin_host
  https_port                     = 443
  certificate_name_check_enabled = true
}

resource "azurerm_cdn_frontdoor_custom_domain" "this" {
  count = var.custom_domain == null ? 0 : 1

  name                     = replace(var.custom_domain, ".", "-")
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id
  host_name                = var.custom_domain

  # Azure-managed certificate. Issuance needs a TXT record (the validation token is an
  # output) and a CNAME to the endpoint, created wherever the zone is hosted -- the DNS
  # zone is not managed here because nothing in this repository says where it lives.
  tls {
    certificate_type = "ManagedCertificate"
  }
}

locals {
  custom_domain_ids = azurerm_cdn_frontdoor_custom_domain.this[*].id
}

resource "azurerm_cdn_frontdoor_route" "api" {
  name                          = "api"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.this.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.api.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.api.id]

  # URL path pattern, not a permission scope: every API route lives under /api/.
  patterns_to_match      = ["/api/*"]
  supported_protocols    = ["Http", "Https"]
  https_redirect_enabled = true
  forwarding_protocol    = "HttpsOnly"

  link_to_default_domain          = true
  cdn_frontdoor_custom_domain_ids = local.custom_domain_ids

  # No `cache` block: API responses are per-user and must never be served from the edge.
}

resource "azurerm_cdn_frontdoor_route" "web" {
  name                          = "web"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.this.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.web.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.web.id]

  # URL path pattern, not a permission scope: the catch-all, so client-side routes
  # reach the SPA shell. Front Door prefers the more specific /api/* route above.
  patterns_to_match      = ["/*"]
  supported_protocols    = ["Http", "Https"]
  https_redirect_enabled = true
  forwarding_protocol    = "HttpsOnly"

  link_to_default_domain          = true
  cdn_frontdoor_custom_domain_ids = local.custom_domain_ids

  # No `cache` block, deliberately. This route serves index.html (directly, and as the
  # storage 404 document for every client-side route) plus the unfingerprinted files at
  # the bundle root. The storage origin sends no Cache-Control, and Front Door keeps a
  # response without one for one to three days -- so a cached shell would go on naming
  # fingerprinted assets a later release has removed, and nothing here can purge it
  # (the deploy identity holds nothing on the profile). Uncached, a release is live as
  # soon as index.html is overwritten. The cost: Front Door compresses only what it
  # caches, so the shell travels uncompressed. It is a few kilobytes.
}

resource "azurerm_cdn_frontdoor_route" "web_assets" {
  name                          = "web-assets"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.this.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.web.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.web.id]

  # URL path pattern, not a permission scope: the directory of content-hashed build
  # output. More specific than the catch-all above, so Front Door prefers it.
  patterns_to_match      = [var.web_fingerprinted_assets_pattern]
  supported_protocols    = ["Http", "Https"]
  https_redirect_enabled = true
  forwarding_protocol    = "HttpsOnly"

  link_to_default_domain          = true
  cdn_frontdoor_custom_domain_ids = local.custom_domain_ids

  cache {
    # Safe to cache for as long as Front Door likes: a fingerprinted file name never
    # changes content, so a stale entry cannot exist. Public and identical for every
    # user, and a query string never selects a different object.
    query_string_caching_behavior = "IgnoreQueryString"
    compression_enabled           = true
    content_types_to_compress = [
      "application/javascript",
      "application/json",
      "image/svg+xml",
      "text/css",
      "text/html",
    ]
  }
}

resource "azurerm_cdn_frontdoor_firewall_policy" "this" {
  # WAF policy names allow letters and digits only.
  name                = "${replace(var.name, "-", "")}waf"
  resource_group_name = var.resource_group_name
  sku_name            = local.sku
  enabled             = true
  mode                = "Prevention"
  tags                = var.tags

  custom_rule {
    name                           = "ApiRateLimit"
    type                           = "RateLimitRule"
    action                         = "Block"
    priority                       = 100
    rate_limit_duration_in_minutes = 1
    rate_limit_threshold           = var.api_rate_limit_per_minute

    match_condition {
      match_variable = "RequestUri"
      operator       = "Contains"
      match_values   = ["/api/"]
    }
  }
}

resource "azurerm_cdn_frontdoor_security_policy" "this" {
  name                     = "${var.name}-waf"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this.id

  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.this.id

      association {
        dynamic "domain" {
          for_each = concat([azurerm_cdn_frontdoor_endpoint.this.id], local.custom_domain_ids)
          content {
            cdn_frontdoor_domain_id = domain.value
          }
        }
        # URL path pattern, not a permission scope: the only value Front Door accepts
        # here -- a WAF policy is associated with a whole domain.
        patterns_to_match = ["/*"]
      }
    }
  }
}
