terraform {
  backend "azurerm" {
    storage_account_name = "athletetfstate"
    container_name       = "prod-base"
    key                  = "terraform.tfstate"
    use_azuread_auth     = true # RBAC on the container, never an account key
  }
}
