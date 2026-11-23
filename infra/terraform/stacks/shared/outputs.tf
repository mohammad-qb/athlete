output "registry_id" {
  description = "Resource ID of the shared registry; base scopes the runtime AcrPull to it."
  value       = azurerm_container_registry.main.id
}

output "registry_login_server" {
  description = "Login server of the shared registry."
  value       = azurerm_container_registry.main.login_server
}

output "deploy_identity_principal_ids" {
  description = "Object IDs of the deploy identities by environment; base assigns its environment-scoped roles to these."
  value       = { for env, id in azurerm_user_assigned_identity.deploy : env => id.principal_id }
}

output "deploy_identity_client_ids" {
  description = "Client IDs by environment: the AZURE_CLIENT_ID of each GitHub environment. An identifier, not a secret."
  value       = { for env, id in azurerm_user_assigned_identity.deploy : env => id.client_id }
}

output "operator_group_object_id" {
  description = "The operator group, passed through so base grants the same humans Key Vault access."
  value       = var.operator_group_object_id
}
