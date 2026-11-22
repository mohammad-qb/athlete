variable "name" {
  description = "Container App name. The edge module derives the API origin hostname from it, so base owns the value and app reads it."
  type        = string
}

variable "migrate_job_name" {
  description = "Container Apps Job name for the migration job (max 32 characters)."
  type        = string
}

variable "resource_group_name" {
  description = "The app resource group -- the only resource group the deploy identity can write to."
  type        = string
}

variable "location" {
  description = "Azure region. Must match the Container Apps environment."
  type        = string
}

variable "container_app_environment_id" {
  description = "Container Apps environment (owned by base) the app and job run in."
  type        = string
}

variable "image" {
  description = "Fully qualified image reference, by digest: <registry>.azurecr.io/athlete-api@sha256:..."
  type        = string
}

variable "registry_server" {
  description = "Login server of the registry the image is pulled from."
  type        = string
}

variable "runtime_identity_id" {
  description = "User-assigned identity the API runs as: pulls the image and resolves the API's Key Vault references."
  type        = string
}

variable "migrate_identity_id" {
  description = "User-assigned identity the migration job runs as. Separate so the serving identity can never read the owner credential."
  type        = string
}

variable "api_secrets" {
  description = "Key Vault references for the API, keyed by container-app secret name."
  type = map(object({
    env_name            = string
    key_vault_secret_id = string
  }))
}

variable "migrate_secrets" {
  description = "Key Vault references for the migration job, keyed by container-app secret name."
  type = map(object({
    env_name            = string
    key_vault_secret_id = string
  }))
}

variable "min_replicas" {
  description = "Minimum API replicas."
  type        = number
}

variable "max_replicas" {
  description = "Maximum API replicas."
  type        = number
}

variable "tags" {
  description = "Tags applied to the app and the job."
  type        = map(string)
}
