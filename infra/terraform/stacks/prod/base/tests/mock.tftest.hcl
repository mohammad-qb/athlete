# A plan against a MOCKED azurerm provider: no credentials, no subscription, no API
# call. It proves the configuration evaluates end to end -- references resolve,
# for_each keys are known at plan time, validation rules fire -- which `validate`
# alone does not. It proves nothing about what Azure would accept.

mock_provider "azurerm" {}

override_data {
  target = data.terraform_remote_state.shared
  values = {
    outputs = {
      registry_id                   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/athlete-shared-rg/providers/Microsoft.ContainerRegistry/registries/athleteplatformacr"
      registry_login_server         = "athleteplatformacr.azurecr.io"
      deploy_identity_principal_ids = { dev = "00000000-0000-0000-0000-000000000002", prod = "00000000-0000-0000-0000-000000000003" }
      operator_group_object_id      = "00000000-0000-0000-0000-000000000001"
    }
  }
}
override_data {
  target = data.azurerm_client_config.current
  values = {
    tenant_id = "00000000-0000-0000-0000-00000000000a"
  }
}

run "plan" {
  command = plan
}
