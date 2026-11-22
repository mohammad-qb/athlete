terraform {
  backend "azurerm" {
    storage_account_name = "athletetfstate"
    container_name       = "dev-app"
    key                  = "terraform.tfstate"
    use_azuread_auth     = true # RBAC on the container, never an account key
    use_oidc             = true
  }
}
