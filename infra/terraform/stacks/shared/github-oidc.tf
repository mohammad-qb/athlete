# ---------------------------------------------------------------------------
# GitHub Actions deploy identities: one per environment, each a user-assigned managed
# identity with a single federated credential. No client secret exists to leak.
#
# Two identities rather than one with two credentials: a shared identity would let the
# dev workflow act on prod.
#
# This file grants only what lives in this stack (state containers, registry). The
# grants on each environment's own resources are in stacks/<env>/base/deploy-access.tf,
# next to the resources they scope to. Between the two files, that is the complete list
# of what a deploy identity can do; neither contains Owner, Contributor, User Access
# Administrator, or any role assignment at subscription or resource-group scope other
# than the custom revision-deployer role on the app resource group.
# ---------------------------------------------------------------------------

resource "azurerm_user_assigned_identity" "deploy" {
  for_each = local.deploy_environments

  name                = "athlete-${each.key}-deploy-id"
  resource_group_name = azurerm_resource_group.shared.name
  location            = azurerm_resource_group.shared.location
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "deploy" {
  for_each = local.deploy_environments

  name      = "github-${each.key}"
  parent_id = azurerm_user_assigned_identity.deploy[each.key].id

  issuer   = "https://token.actions.githubusercontent.com"
  audience = ["api://AzureADTokenExchange"]
  # Exact match -- standard federated credentials have no wildcard form. Only a job in
  # this repository that declares `environment: <env>` gets a token Azure will accept;
  # a pull request, a fork, or a branch push without the environment does not. The
  # required-reviewer gate on the `prod` GitHub environment is configured in GitHub,
  # not here.
  subject = "repo:${var.github_repository}:environment:${each.key}"
}

# --- State -----------------------------------------------------------------

# Read/write its own state. Container scope is as narrow as blob RBAC goes without an
# ABAC condition; the container holds exactly one blob (plus its lease), so the two are
# equivalent here. Contributor rather than a write-only role because the azurerm
# backend takes a blob lease to lock and rewrites the blob in place. It can also delete
# its own state blob -- recoverable (versioning + 30-day soft delete, which this role
# cannot purge) and unable to touch any other stack.
resource "azurerm_role_assignment" "deploy_own_state" {
  for_each = local.deploy_environments

  scope                = azurerm_storage_container.state["${each.key}-app"].id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.deploy[each.key].principal_id
  principal_type       = "ServicePrincipal"
}

# Read base outputs. Broader than it sounds, and said so: Terraform has no
# "outputs only" read, so this is read access to the WHOLE base state of its own
# environment. That is why base keeps every credential out of state with write-only
# arguments -- see the README, "What the deploy identity can read".
resource "azurerm_role_assignment" "deploy_base_state_read" {
  for_each = local.deploy_environments

  scope                = azurerm_storage_container.state["${each.key}-base"].id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.deploy[each.key].principal_id
  principal_type       = "ServicePrincipal"
}

# --- Registry --------------------------------------------------------------

# Registry scope, not repository scope: narrowing AcrPush/AcrPull to one repository
# needs the registry in ABAC repository-permissions mode. Not worth it while the
# registry holds exactly one repository (athlete-api). Revisit if a second image
# appears.
resource "azurerm_role_assignment" "deploy_registry" {
  for_each = local.deploy_environments

  scope                = azurerm_container_registry.main.id
  role_definition_name = each.value.registry_role
  principal_id         = azurerm_user_assigned_identity.deploy[each.key].principal_id
  principal_type       = "ServicePrincipal"
}
