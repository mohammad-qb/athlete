# ---------------------------------------------------------------------------
# The API: one container, one deployable.
#
# Not Kubernetes, and the reasoning is the point: at 100-200 concurrent users
# (~2,000 at the 10x ceiling) a control plane, cluster upgrades and the operational
# surface of EKS/AKS buy nothing a small team can spend. Because this is a plain
# container plus managed Postgres, the same image also runs under `docker compose` on
# a single VM -- which is the answer to both "run it on one server" and "cut the
# budget by 40%" without redesigning anything.
# ---------------------------------------------------------------------------

resource "azurerm_container_app_environment" "main" {
  name                       = "${local.name}-cae"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.tags
}

resource "azurerm_user_assigned_identity" "api" {
  name                = "${local.name}-api-id"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags
}

# The API pulls its own image and reads its own secrets. No registry password and no
# connection string is ever stored in CI or in the repository.
resource "azurerm_role_assignment" "api_acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_role_assignment" "api_kv_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_container_app" "api" {
  name                         = "${local.name}-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  registry {
    server   = azurerm_container_registry.main.login_server
    identity = azurerm_user_assigned_identity.api.id
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = azurerm_key_vault_secret.database_url.id
    identity            = azurerm_user_assigned_identity.api.id
  }

  secret {
    name                = "session-secret"
    key_vault_secret_id = azurerm_key_vault_secret.session_secret.id
    identity            = azurerm_user_assigned_identity.api.id
  }

  template {
    # min_replicas >= 2 so a revision swap is not a cold start, and a single node
    # failure is not an outage. Cheap at this size; the first lever to pull on cost.
    min_replicas = var.api_min_replicas
    max_replicas = var.api_max_replicas

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "SESSION_SECRET"
        secret_name = "session-secret"
      }
      env {
        name  = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        value = azurerm_application_insights.main.connection_string
      }

      # Liveness deliberately does not touch Postgres. A DB-dependent liveness probe
      # turns a database blip into a restart storm, converting degradation into outage.
      liveness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/v1/health"
      }

      # Readiness MAY check the database: an instance that cannot serve should leave
      # the load-balancer rotation without being killed.
      readiness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/v1/health"
      }
    }

    # Concurrency-based scaling, not CPU: this workload is IO-bound on Postgres, so
    # CPU would under-react right when queueing starts.
    http_scale_rule {
      name                = "concurrent-requests"
      concurrent_requests = 80
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  lifecycle {
    # CI sets the image on each deploy; Terraform should not fight it or revert it.
    ignore_changes = [template[0].container[0].image]
  }
}

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "azurerm_key_vault_secret" "session_secret" {
  name         = "session-secret"
  value        = random_password.session_secret.result
  key_vault_id = azurerm_key_vault.main.id
}
