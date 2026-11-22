# A plan against a MOCKED azurerm provider: no credentials, no subscription, no API
# call. It proves the configuration evaluates end to end -- references resolve,
# for_each keys are known at plan time, validation rules fire -- which `validate`
# alone does not. It proves nothing about what Azure would accept.

mock_provider "azurerm" {}

variables {
  operator_group_object_id = "00000000-0000-0000-0000-000000000001"
}

run "plan" {
  command = plan
}
