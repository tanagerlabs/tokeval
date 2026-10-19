output "worker_id" {
  description = "Cloudflare Worker identifier."
  value       = cloudflare_worker.tokenizer_api.id
}

output "worker_name" {
  description = "Worker name used by Wrangler deployments."
  value       = cloudflare_worker.tokenizer_api.name
}
