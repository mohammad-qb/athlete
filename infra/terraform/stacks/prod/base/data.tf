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

# The addresses Front Door reaches origins from. The API needs them to read
# X-Forwarded-For: its sign-in rate limit is per client address, and it trusts an
# address in a forwarded chain only when it knows which hops are proxies.
#
# A snapshot, not a subscription: Azure revises these ranges, and a new range reaches the
# API only when `base` and then `app` are applied again. Until then, sign-ins arriving
# through an unlisted range fall back to one shared rate-limit bucket -- degraded, not
# open. Service tags are regional lists with a global "AzureFrontDoor.Backend" entry.
data "azurerm_network_service_tags" "front_door_backend" {
  location = local.location
  service  = "AzureFrontDoor.Backend"
}
