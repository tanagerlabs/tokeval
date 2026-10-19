variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the Worker."
  type        = string
  sensitive   = true
}

variable "worker_name" {
  description = "Stable Worker resource name; keep aligned with wrangler.jsonc."
  type        = string
  default     = "tokeval-tokenizer-api"
}

variable "enable_workers_dev" {
  description = "Whether the Worker is reachable on workers.dev before a custom domain is attached."
  type        = bool
  default     = true
}

variable "observability_sample_rate" {
  description = "Fraction of invocations sampled by Cloudflare observability."
  type        = number
  default     = 0.1

  validation {
    condition     = var.observability_sample_rate >= 0 && var.observability_sample_rate <= 1
    error_message = "observability_sample_rate must be between 0 and 1."
  }
}
