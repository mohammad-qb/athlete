# Lives here rather than at the repository root because Terraform is the only thing it
# configures and `infra/terraform` is the directory every Terraform command in the
# README and in CI runs from.
#
# Run it as:  tflint --recursive --config "$(pwd)/.tflint.hcl"
# The --config is not optional. In --recursive mode tflint looks for a .tflint.hcl in
# each directory it descends into; finding none, it runs the bundled rules only and
# exits 0 without ever loading the azurerm ruleset below.

tflint {
  required_version = ">= 0.66"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "azurerm" {
  enabled = true
  version = "0.33.0"
  source  = "github.com/terraform-linters/tflint-ruleset-azurerm"
}
