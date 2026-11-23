# ---------------------------------------------------------------------------
# What the CI deploy identity may do in this environment. Together with
# stacks/shared/github-oidc.tf (its state containers and the registry) this is the
# complete list. It holds no built-in Contributor/Owner anywhere and no
# Microsoft.Authorization/roleAssignments/write, so it cannot grant itself more.
#
# NEVER EXERCISED: there is no subscription. The action lists below are derived from
# the Azure permission reference and from what the azurerm provider calls; the first
# real apply will be the first test. When it fails with AuthorizationFailed, add the
# one missing action here WITH the error text as its comment -- that is the house rule,
# and it is how this list becomes evidence instead of a guess.
#
# Most likely first failure, named so it is recognised rather than "fixed" with
# Contributor: Container Apps writes are long-running, and the provider polls
# Microsoft.App/locations/containerappOperationStatuses, which is a subscription-level
# path outside both resource groups. If that poll is refused, the fix is a custom role
# holding that single read action at subscription scope -- and nothing else.
# ---------------------------------------------------------------------------

# --- 1. Ship a revision: write container apps and the migration job, app RG only ----

resource "azurerm_role_definition" "revision_deployer" {
  name        = "Athlete ${local.environment} revision deployer"
  scope       = azurerm_resource_group.app.id
  description = "Create and update the API container app and migration job in ${azurerm_resource_group.app.name}. No delete, no identity, no network, no role assignment."

  permissions {
    actions = [
      # The API container app. No `delete`: removing the app is a teardown, and
      # teardowns are a human's job.
      "Microsoft.App/containerApps/read",
      "Microsoft.App/containerApps/write",
      # azurerm_container_app reads the secret list on every refresh. These are Key
      # Vault REFERENCES (a URL and an identity), not values -- no secret value is
      # stored on the app for this to return.
      "Microsoft.App/containerApps/listSecrets/action",
      "Microsoft.App/containerApps/revisions/read",

      # The migration job: update its definition, start an execution, watch it finish.
      "Microsoft.App/jobs/read",
      "Microsoft.App/jobs/write",
      "Microsoft.App/jobs/listSecrets/action",
      "Microsoft.App/jobs/start/action",
      "Microsoft.App/jobs/executions/read",
    ]
  }

  assignable_scopes = [azurerm_resource_group.app.id]
}

resource "azurerm_role_assignment" "deploy_revision" {
  scope              = azurerm_resource_group.app.id
  role_definition_id = azurerm_role_definition.revision_deployer.role_definition_resource_id
  principal_id       = local.deploy_identity_principal_id
  principal_type     = "ServicePrincipal"
}

# --- 2. Place the app in the environment base owns ------------------------------

# A container app in one resource group that names an environment in another needs
# `join` on that environment. Defined on the base resource group because a custom
# role's assignable scope cannot be a single resource -- but ASSIGNED below on the one
# environment, so nothing else in base is in reach.
resource "azurerm_role_definition" "environment_joiner" {
  name        = "Athlete ${local.environment} environment joiner"
  scope       = azurerm_resource_group.base.id
  description = "Read the Container Apps environment and place an app or job in it. Cannot modify the environment."

  permissions {
    actions = [
      "Microsoft.App/managedEnvironments/read",
      "Microsoft.App/managedEnvironments/join/action",
    ]
  }

  assignable_scopes = [azurerm_resource_group.base.id]
}

resource "azurerm_role_assignment" "deploy_environment_join" {
  scope              = azurerm_container_app_environment.main.id
  role_definition_id = azurerm_role_definition.environment_joiner.role_definition_resource_id
  principal_id       = local.deploy_identity_principal_id
  principal_type     = "ServicePrincipal"
}

# --- 3. Attach the two workload identities, and only those two -------------------

# The Azure counterpart of scoping iam:PassRole to exact role ARNs. Setting a
# user-assigned identity on a container app requires
# Microsoft.ManagedIdentity/userAssignedIdentities/assign/action on THAT identity, so
# the role is assigned on each identity individually. Assigned on a resource group it
# would let a revision run as any identity in the group -- including one added later
# for something else entirely.
resource "azurerm_role_assignment" "deploy_assign_identity" {
  for_each = {
    api     = azurerm_user_assigned_identity.api.id
    migrate = azurerm_user_assigned_identity.migrate.id
  }

  scope                = each.value
  role_definition_name = "Managed Identity Operator"
  principal_id         = local.deploy_identity_principal_id
  principal_type       = "ServicePrincipal"
}

# --- 4. Upload the SPA bundle ------------------------------------------------------

# Not in the plan's list for the deploy identity, added because the SPA is half of
# every release. One container, not the account: the role is scoped to `$web`.
# Contributor rather than a narrower role because an upload overwrites index.html and
# removes superseded fingerprinted assets.
resource "azurerm_role_assignment" "deploy_web_upload" {
  scope                = module.static_site.web_container_scope
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = local.deploy_identity_principal_id
  principal_type       = "ServicePrincipal"
}
