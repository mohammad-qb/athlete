variable "name" {
  description = "Server name. Globally unique within Azure Postgres; the caller owns the naming scheme."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group the server is created in."
  type        = string
}

variable "location" {
  description = "Azure region of the server."
  type        = string
}

variable "sku_name" {
  description = "Flexible Server SKU, e.g. B_Standard_B2s or GP_Standard_D2ds_v4."
  type        = string
}

variable "storage_mb" {
  description = "Provisioned storage in MB."
  type        = number
}

variable "zone_redundant_ha" {
  description = <<-EOT
    Zone-redundant HA. Roughly doubles the database line item, so it is the first thing
    to drop under the "budget reduced by 40%" scenario -- at the cost of a stated
    increase in RTO, not of data loss.
  EOT
  type        = bool

  validation {
    # Azure rejects high availability on the Burstable tier. Failing here costs a
    # second; failing at apply costs a half-created server.
    condition     = !(var.zone_redundant_ha && startswith(var.sku_name, "B_"))
    error_message = "Zone-redundant HA is not available on Burstable (B_*) SKUs; use a General Purpose or Memory Optimized SKU, or turn HA off."
  }
}

variable "geo_redundant_backup" {
  description = "Geo-redundant backup to the paired region (UAE Central for UAE North). Immutable after creation."
  type        = bool
}

variable "delegated_subnet_id" {
  description = "Subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers. The server has no public endpoint."
  type        = string
}

variable "private_dns_zone_id" {
  description = "Private DNS zone (*.postgres.database.azure.com) linked to the VNet of the delegated subnet."
  type        = string
}

variable "administrator_login" {
  description = "Admin (owner) role. Used by the migration job and break-glass only; the API never connects as this role."
  type        = string
}

variable "administrator_password" {
  description = "Admin password. Ephemeral: it is passed to a write-only argument and never stored in state."
  type        = string
  sensitive   = true
  ephemeral   = true
}

variable "administrator_password_version" {
  description = "Bump to make Terraform send administrator_password again (rotation)."
  type        = number
}

variable "database_name" {
  description = "Application database name."
  type        = string
}

variable "tags" {
  description = "Tags applied to the server."
  type        = map(string)
}
