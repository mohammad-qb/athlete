# Cross-stack read. This stack is deliberately tiny -- the container app and the
# migration job, the two resources that change per deploy -- so the identity applying
# it needs no identity, network, database or Key Vault write.
#
# Remote state rather than data sources: a data source would need the deploy identity
# to hold read on each base resource it looked up, and for Key Vault that means either
# reading secret values or a vault-wide reader role. The cost of remote state -- the
# whole base state is readable, not just its outputs -- is handled in base, which keeps
# credentials out of state.
data "terraform_remote_state" "base" {
  backend = "azurerm"

  config = {
    storage_account_name = "athletetfstate"
    container_name       = "prod-base"
    key                  = "terraform.tfstate"
    use_azuread_auth     = true
    use_oidc             = true
  }
}
