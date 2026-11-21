variable "project" {
  description = "Short name used as a prefix for all resource names."
  type        = string
  default     = "athlete"
}

variable "environment" {
  description = "Environment name. Drives sizing and HA defaults."
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging or prod."
  }
}

variable "location" {
  description = <<-EOT
    Primary Azure region.

    UAE North (Dubai) is the default deliberately. AWS me-central-1 has been impaired
    since the 1 March 2026 strikes, with permanent loss of data resident only in
    mec1-az2, and Google Cloud has no UAE region at all -- so Azure is the only
    provider currently offering an in-country primary WITH an in-country DR region.
  EOT
  type        = string
  default     = "uaenorth"
}

variable "dr_location" {
  description = "In-country DR region (Abu Dhabi), used for geo-redundant backup."
  type        = string
  default     = "uaecentral"
}

variable "postgres_sku" {
  description = "Flexible Server SKU. B2s at launch; see docs/05-deployment.md for the scaling path."
  type        = string
  default     = "B_Standard_B2s"
}

variable "postgres_storage_mb" {
  type    = number
  default = 65536
}

variable "enable_zone_redundant_ha" {
  description = <<-EOT
    Zone-redundant Postgres HA. Roughly doubles the database line item, so it is the
    first thing to drop under the "budget reduced by 40%" scenario -- at the cost of a
    stated increase in RTO, not of data loss.
  EOT
  type        = bool
  default     = true
}

variable "api_image" {
  description = "Fully qualified container image for the API, set by CI per deploy."
  type        = string
}

variable "api_min_replicas" {
  type    = number
  default = 2
}

variable "api_max_replicas" {
  type    = number
  default = 6
}

variable "offsite_backup_bucket_url" {
  description = <<-EOT
    Out-of-country, out-of-provider destination for the nightly encrypted dump. The
    dump is encrypted client-side with a key held in this region's Key Vault, so the
    remote provider stores ciphertext it cannot read -- which is how the third backup
    tier coexists with "no personal data leaves the UAE in readable form".
  EOT
  type    = string
  default = ""
}

variable "tags" {
  type = map(string)
  default = {
    workload   = "athlete-platform"
    managed_by = "terraform"
  }
}
