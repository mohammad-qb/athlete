variable "name" {
  description = "Storage account name: 3-24 lowercase alphanumerics, globally unique."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group the storage account is created in."
  type        = string
}

variable "location" {
  description = "Azure region of the storage account."
  type        = string
}

variable "replication_type" {
  description = "LRS for non-production, GZRS for production."
  type        = string
}

variable "tags" {
  description = "Tags applied to the storage account."
  type        = map(string)
}
