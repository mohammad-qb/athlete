# Applied by the pipeline as the deploy identity, via GitHub OIDC. ARM_CLIENT_ID,
# ARM_TENANT_ID and ARM_SUBSCRIPTION_ID come from the GitHub environment; none of them
# is a secret and there is no client secret to store.
provider "azurerm" {
  features {}

  use_oidc = true

  # By default the provider registers a list of resource providers on the subscription
  # at startup. The deploy identity has no subscription-scoped permission at all, so
  # that would fail with AuthorizationFailed on
  # Microsoft.Resources/subscriptions/providers/register/action before any resource was
  # read. Registration is a one-off done by the operator applying base.
  resource_provider_registrations = "none"
}
