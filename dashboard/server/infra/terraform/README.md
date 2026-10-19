# Cloudflare infrastructure

Terraform owns the long-lived Worker resource and its stable policy. Wrangler
owns application bundling, runtime bindings, immutable code versions, and
secret values. This split avoids placing provider secrets in Terraform state
and follows Cloudflare's documented hybrid IaC pattern.

## Prerequisites

- Terraform 1.10 or later.
- A Cloudflare API token with Workers Scripts read/write permissions.
- `CLOUDFLARE_API_TOKEN` exported in the deployment environment.

Use a remote encrypted Terraform backend with locking in production. Local
state and `.tfvars` files are ignored only as a safety net; they are not a
production state strategy.

## Provision

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply
```

Then return to `dashboard/server/`, provision secrets with `wrangler secret put`, run the
dry-run build, and deploy the application version.

Do not declare provider API keys as Terraform variables. Terraform state can
retain secret values even when an input is marked sensitive.

The current module intentionally does not provision D1, users, subscriptions,
or premium-tier resources. Those should be added only when their data model and
retention policy are defined.
