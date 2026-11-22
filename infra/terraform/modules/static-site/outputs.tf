output "storage_account_id" {
  description = "Resource ID of the storage account."
  value       = azurerm_storage_account.this.id
}

output "storage_account_name" {
  description = "Name of the storage account (the upload target for the SPA bundle)."
  value       = azurerm_storage_account.this.name
}

output "web_host" {
  description = "Hostname of the static website endpoint, without scheme. The edge module's SPA origin."
  value       = azurerm_storage_account.this.primary_web_host
}

output "web_container_scope" {
  description = "ARM scope of the $web container, for a role assignment narrower than the account."
  # `$web` is the literal name of the container the static website serves from (a bare
  # `$` is not an interpolation in HCL; only `${` is).
  value = "${azurerm_storage_account.this.id}/blobServices/default/containers/$web"

  # The container only exists once static website hosting is enabled.
  depends_on = [azurerm_storage_account_static_website.this]
}
