# The whole stack: one module call. If something here needs a permission the deploy
# identity does not have, the answer is almost always "it belongs in base".
module "api" {
  source = "../../../modules/container-app"

  name                         = local.base.api_app_name
  migrate_job_name             = local.base.migrate_job_name
  resource_group_name          = local.base.app_resource_group_name
  location                     = local.base.location
  container_app_environment_id = local.base.container_app_environment_id

  image           = var.api_image
  registry_server = local.base.registry_login_server

  runtime_identity_id = local.base.api_identity_id
  migrate_identity_id = local.base.migrate_identity_id
  api_secrets         = local.base.api_secrets
  migrate_secrets     = local.base.migrate_secrets
  app_base_url        = local.base.app_base_url
  trusted_proxies     = local.base.auth_trusted_proxies

  min_replicas = local.api_min_replicas
  max_replicas = local.api_max_replicas

  tags = local.tags
}
