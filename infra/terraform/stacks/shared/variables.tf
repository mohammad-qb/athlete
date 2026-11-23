variable "location" {
  description = "Region for the cross-environment resources. UAE North, for the same residency reason as everything else."
  type        = string
  default     = "uaenorth"
}

variable "github_repository" {
  description = "owner/name of the only repository allowed to assume the deploy identities."
  type        = string
  default     = "mohammad-qb/athlete"
}

variable "operator_group_object_id" {
  description = <<-EOT
    Entra ID group of the humans who apply `shared` and `base`. No default on purpose:
    "who can change identity, network and database" should be a named group, not
    whoever happened to run the first apply.
  EOT
  type        = string
}

variable "state_storage_account_name" {
  description = "Globally unique name of the Terraform state account. Repeated literally in every backend.tf and data.tf."
  type        = string
  default     = "athletetfstate"
}

variable "registry_name" {
  description = "Globally unique name of the container registry (5-50 alphanumerics)."
  type        = string
  default     = "athleteplatformacr"
}
