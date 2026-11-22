# Chicken and egg: this stack creates the storage account its own state lives in.
# First apply runs with this block commented out (local state), then
# `terraform init -migrate-state` moves the state in. See the README, "Bootstrap".
#
# Backend blocks cannot use variables, so the account name is repeated in every stack's
# backend.tf and data.tf. It must match var.state_storage_account_name.
terraform {
  backend "azurerm" {
    storage_account_name = "athletetfstate"
    container_name       = "shared"
    key                  = "terraform.tfstate"
    use_azuread_auth     = true # RBAC on the container, never an account key
  }
}
