output "api_fqdn" {
  description = "Origin hostname of the API container app (public traffic goes through the edge host in base)."
  value       = module.api.fqdn
}

output "latest_revision_name" {
  description = "Revision created by this apply."
  value       = module.api.latest_revision_name
}

output "migrate_job_name" {
  description = "Migration job to start (no overrides) after the targeted apply has given it the new image and before the full apply."
  value       = module.api.migrate_job_name
}
