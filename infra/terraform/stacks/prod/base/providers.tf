# Applied by a human operator (az login), never by CI. The subscription comes from
# ARM_SUBSCRIPTION_ID, so no subscription ID is committed.
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false # never purge secrets on a destroy
    }
  }

  # The SPA storage account and the state account both refuse account keys, so the
  # provider's storage data-plane calls must authenticate with Entra ID.
  storage_use_azuread = true
}
