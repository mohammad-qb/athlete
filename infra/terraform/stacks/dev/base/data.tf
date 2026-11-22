# Cross-stack read: the registry and the deploy identity come from `shared`.
data "terraform_remote_state" "shared" {
  backend = "azurerm"

  config = {
    storage_account_name = "athletetfstate"
    container_name       = "shared"
    key                  = "terraform.tfstate"
    use_azuread_auth     = true
  }
}

data "azurerm_client_config" "current" {}
