# Everything the app stack needs, and nothing it does not. The app stack reads these
# through remote state -- which means it can read the rest of this state too. Keep
# credentials out of it (key-vault.tf) rather than relying on this list being short.

output "app_resource_group_name" {
  description = "Resource group the app stack deploys into."
  value       = azurerm_resource_group.app.name
}

output "location" {
  description = "Region of the environment."
  value       = local.location
}

output "container_app_environment_id" {
  description = "Container Apps environment the API and migration job run in."
  value       = azurerm_container_app_environment.main.id
}

output "api_app_name" {
  description = "Name the API container app must be created with; the edge origin hostname is derived from it."
  value       = local.api_app_name
}

output "migrate_job_name" {
  description = "Name of the migration job."
  value       = local.migrate_job_name
}

output "registry_login_server" {
  description = "Registry login server, passed through from `shared` so the app stack reads one state, not two."
  value       = data.terraform_remote_state.shared.outputs.registry_login_server
}

output "api_identity_id" {
  description = "User-assigned identity the API runs as."
  value       = azurerm_user_assigned_identity.api.id
}

output "migrate_identity_id" {
  description = "User-assigned identity the migration job runs as."
  value       = azurerm_user_assigned_identity.migrate.id
}

output "api_secrets" {
  description = "Key Vault references for the API: secret name => env var and versionless secret URL. URLs, not values."
  value = {
    "database-url" = {
      env_name            = "DATABASE_URL"
      key_vault_secret_id = azurerm_key_vault_secret.database_url.versionless_id
    }
    "auth-database-url" = {
      env_name            = "AUTH_DATABASE_URL"
      key_vault_secret_id = azurerm_key_vault_secret.auth_database_url.versionless_id
    }
    "session-secret" = {
      env_name            = "SESSION_SECRET"
      key_vault_secret_id = azurerm_key_vault_secret.session_secret.versionless_id
    }
    "appinsights-connection-string" = {
      env_name            = "APPLICATIONINSIGHTS_CONNECTION_STRING"
      key_vault_secret_id = azurerm_key_vault_secret.appinsights_connection_string.versionless_id
    }
  }
}

output "migrate_secrets" {
  description = "Key Vault references for the migration job. URLs, not values."
  value = {
    "database-migration-url" = {
      env_name            = "DATABASE_URL"
      key_vault_secret_id = azurerm_key_vault_secret.database_migration_url.versionless_id
    }
    "app-role-password" = {
      env_name            = "APP_ROLE_PASSWORD"
      key_vault_secret_id = azurerm_key_vault_secret.app_role_password.versionless_id
    }
    "auth-role-password" = {
      env_name            = "AUTH_ROLE_PASSWORD"
      key_vault_secret_id = azurerm_key_vault_secret.auth_role_password.versionless_id
    }
  }
}

output "app_base_url" {
  description = "The origin a browser sees (APP_BASE_URL): the only origin the API accepts state-changing requests from, and the one session cookies are issued for. Not a secret."
  value       = "https://${coalesce(local.custom_domain, module.edge.endpoint_host)}"
}

output "auth_trusted_proxies" {
  description = "CIDR ranges of the reverse proxies in front of the API (AUTH_TRUSTED_PROXIES): Front Door's backend ranges. Not a secret."
  value       = data.azurerm_network_service_tags.front_door_backend.address_prefixes
}

output "edge_host" {
  description = "Front Door hostname serving the SPA and /api/."
  value       = module.edge.endpoint_host
}

output "custom_domain_validation_token" {
  description = "TXT record value for custom-domain validation; null without a custom domain."
  value       = module.edge.custom_domain_validation_token
}

output "web_storage_account_name" {
  description = "Storage account the SPA bundle is uploaded to (container $web)."
  value       = module.static_site.storage_account_name
}

output "key_vault_name" {
  description = "Key Vault holding the environment's secrets and the backup key."
  value       = azurerm_key_vault.main.name
}

output "postgres_fqdn" {
  description = "Private FQDN of the database; resolves only inside the VNet."
  value       = module.postgres.fqdn
}

output "residency_note" {
  description = "Surfaced as an output so the decision is visible in every plan."
  value = join(" ", [
    "Primary ${local.location} (UAE), DR ${local.dr_location} (UAE).",
    "Telemetry and identity data stay in-region.",
    "Tier-3 backups leave the country as ciphertext only, keyed from in-country Key Vault.",
  ])
}
