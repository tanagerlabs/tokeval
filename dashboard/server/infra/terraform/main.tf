provider "cloudflare" {}

resource "cloudflare_worker" "tokenizer_api" {
  account_id = var.cloudflare_account_id
  name       = var.worker_name

  observability = {
    enabled            = true
    head_sampling_rate = var.observability_sample_rate
  }

  subdomain = {
    enabled          = var.enable_workers_dev
    previews_enabled = false
  }

  tags = ["tokeval", "hosted-tokenizer-api"]
}
