output "fqdn" {
  description = "Stable ingress hostname of the API (not the per-revision one)."
  value       = azurerm_container_app.api.ingress[0].fqdn
}

output "latest_revision_name" {
  description = "Revision created by the most recent apply."
  value       = azurerm_container_app.api.latest_revision_name
}

output "migrate_job_name" {
  description = "Name of the migration job, for `az containerapp job start` (without container overrides: they replace the job template)."
  value       = azurerm_container_app_job.migrate.name
}
