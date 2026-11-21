output "api_fqdn" {
  description = "Public hostname of the API container app."
  value       = azurerm_container_app.api.latest_revision_fqdn
}

output "web_endpoint" {
  description = "Static website endpoint serving the SPA."
  value       = azurerm_storage_account.web.primary_web_endpoint
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.main.fqdn
}

output "registry_login_server" {
  value = azurerm_container_registry.main.login_server
}

output "key_vault_name" {
  value = azurerm_key_vault.main.name
}

output "residency_note" {
  description = "Surfaced as an output so the decision is visible in every plan."
  value = join(" ", [
    "Primary ${var.location} (UAE), DR ${var.dr_location} (UAE).",
    "Telemetry and identity data stay in-region.",
    "Tier-3 backups leave the country as ciphertext only, keyed from in-country Key Vault.",
  ])
}
