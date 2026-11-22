variable "api_image" {
  description = "Image to deploy, by digest, set by the pipeline: <registry>.azurecr.io/athlete-api@sha256:<digest>."
  type        = string

  validation {
    # A tag can be moved after review; a digest cannot. Production deploys the digest
    # dev tested, so both environments take the same form.
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "api_image must be pinned by digest (…@sha256:<64 hex>), not by tag."
  }
}
