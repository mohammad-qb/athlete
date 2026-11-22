output "endpoint_host" {
  description = "Default *.azurefd.net hostname serving both the SPA and /api/."
  value       = azurerm_cdn_frontdoor_endpoint.this.host_name
}

output "profile_id" {
  description = "Resource ID of the Front Door profile."
  value       = azurerm_cdn_frontdoor_profile.this.id
}

output "custom_domain_validation_token" {
  description = "Value for the _dnsauth TXT record that proves ownership of custom_domain. Null without a custom domain."
  value       = one(azurerm_cdn_frontdoor_custom_domain.this[*].validation_token)
}
