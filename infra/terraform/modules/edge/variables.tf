variable "name" {
  description = "Prefix for the Front Door profile, endpoint and child resources."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group the profile and WAF policy are created in."
  type        = string
}

variable "web_origin_host" {
  description = "Static website hostname (no scheme) serving the SPA bundle."
  type        = string
}

variable "api_origin_host" {
  description = "Stable ingress hostname of the API container app (no scheme)."
  type        = string
}

variable "web_fingerprinted_assets_pattern" {
  description = <<-EOT
    Front Door path pattern for the SPA's content-hashed build output -- the only web
    paths cached at the edge. Everything else on the web origin (index.html above all)
    is served uncached. The default is Vite's `build.assetsDir`; change both together.
    Nothing unfingerprinted may live under it: such a file would be served stale for
    up to three days after a release.
  EOT
  type        = string
  default     = "/assets/*"
}

variable "custom_domain" {
  description = "Public hostname, e.g. app.example.com. Null serves on the *.azurefd.net default domain only."
  type        = string
  default     = null
}

variable "api_rate_limit_per_minute" {
  description = <<-EOT
    Requests per minute per client IP to /api/ before the WAF blocks. Deliberately
    loose: a whole club's staff can sit behind one office NAT address, so a per-IP
    limit sized for one person would lock out a club. This is a flood brake, not abuse
    detection.
  EOT
  type        = number
}

variable "tags" {
  description = "Tags applied to the profile and WAF policy."
  type        = map(string)
}
