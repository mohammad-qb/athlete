# Applied by a human operator (az login). The subscription comes from
# ARM_SUBSCRIPTION_ID, so no subscription ID is committed.
provider "azurerm" {
  features {}

  # The state account has shared-key access disabled; data-plane calls must use
  # Entra ID.
  storage_use_azuread = true
}
