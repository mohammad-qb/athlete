# ---------------------------------------------------------------------------
# The API: one container, one deployable.
#
# Not Kubernetes, and the reasoning is the point: at 100-200 concurrent users
# (~2,000 at the 10x ceiling) a control plane, cluster upgrades and the operational
# surface of EKS/AKS buy nothing a small team can spend. Because this is a plain
# container plus managed Postgres, the same image also runs under `docker compose` on
# a single VM -- which is the answer to both "run it on one server" and "cut the
# budget by 40%" without redesigning anything.
#
# Everything in this module is what changes per deploy, and nothing else is. That is
# what lets the identity that applies it hold no identity, network or database write.
# ---------------------------------------------------------------------------

locals {
  port = 3000
}

resource "azurerm_container_app" "api" {
  name                         = var.name
  container_app_environment_id = var.container_app_environment_id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.runtime_identity_id]
  }

  # The API pulls its own image and reads its own secrets. No registry password and no
  # connection string is ever stored in CI or in the repository.
  registry {
    server   = var.registry_server
    identity = var.runtime_identity_id
  }

  # References, not values: the deploy identity names a secret, and only the runtime
  # identity can resolve it. No secret value passes through this stack or its state.
  dynamic "secret" {
    for_each = var.api_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value.key_vault_secret_id
      identity            = var.runtime_identity_id
    }
  }

  template {
    # min_replicas >= 2 in production so a revision swap is not a cold start, and a
    # single node failure is not an outage. Cheap at this size; the first lever to pull
    # on cost.
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = "api"
      image  = var.image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = tostring(local.port)
      }
      # Not a secret: the public origin. The API refuses to boot without it.
      env {
        name  = "APP_BASE_URL"
        value = var.app_base_url
      }
      # Not a secret: published address ranges. Empty would leave every sign-in in one
      # shared rate-limit bucket, which is why the variable has no default.
      env {
        name  = "AUTH_TRUSTED_PROXIES"
        value = join(",", var.trusted_proxies)
      }

      dynamic "env" {
        for_each = var.api_secrets
        content {
          name        = env.value.env_name
          secret_name = env.key
        }
      }

      # Liveness deliberately does not touch Postgres. A DB-dependent liveness probe
      # turns a database blip into a restart storm, converting degradation into outage.
      liveness_probe {
        transport = "HTTP"
        port      = local.port
        path      = "/api/v1/health"
      }

      # Readiness MAY check the database: an instance that cannot serve should leave
      # the load-balancer rotation without being killed.
      readiness_probe {
        transport = "HTTP"
        port      = local.port
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
    # External because Front Door Standard reaches origins over the public internet;
    # Private Link origins need Front Door Premium. The consequence -- the origin can be
    # reached directly, bypassing the WAF -- is recorded in the README, not hidden.
    external_enabled = true
    target_port      = local.port
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  # No `ignore_changes` on the image, unlike the flat config this replaced: the image
  # is this stack's input, and the stack is applied by the pipeline on every deploy.
}

# ---------------------------------------------------------------------------
# The migration job: the same image, a different command, a different identity.
#
# Postgres has no public endpoint, so a GitHub-hosted runner cannot reach it; the
# migration has to run inside the VNet. Each deploy is two applies of this stack with
# the same image:
#   1. `apply -target=module.api.azurerm_container_app_job.migrate` -- creates the job
#      on a first deploy, otherwise moves its stored image to the NEW one;
#   2. `az containerapp job start` with NO overrides, wait for it to succeed;
#   3. the full apply, which is the only step that touches the API.
# So migrations still run as their own step, before the app deploy, with the
# application on the previous image -- and on a first deploy before the API exists.
#
# Not `az containerapp job start --image ...`: any container flag makes the CLI send an
# execution template that REPLACES this one rather than patching it -- no `command`, no
# secret-backed env, and a container named after the job. That execution would run
# the image's default command, without DATABASE_URL, instead of migrating.
#
# Between steps 1 and 3 the job is ahead of the app. If the migration fails the
# pipeline stops there; the job keeps the new image until the next deploy or a
# rollback apply moves it, which matters only to someone starting the job by hand.
# ---------------------------------------------------------------------------
resource "azurerm_container_app_job" "migrate" {
  name                         = var.migrate_job_name
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.container_app_environment_id
  tags                         = var.tags

  replica_timeout_in_seconds = 900
  # A migration that failed half-way must be looked at, not re-run by a scheduler.
  replica_retry_limit = 0

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.migrate_identity_id]
  }

  registry {
    server   = var.registry_server
    identity = var.migrate_identity_id
  }

  dynamic "secret" {
    for_each = var.migrate_secrets
    content {
      name                = secret.key
      key_vault_secret_id = secret.value.key_vault_secret_id
      identity            = var.migrate_identity_id
    }
  }

  template {
    container {
      name    = "migrate"
      image   = var.image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "dist/db/migrate.js"]

      dynamic "env" {
        for_each = var.migrate_secrets
        content {
          name        = env.value.env_name
          secret_name = env.key
        }
      }
    }
  }
}
