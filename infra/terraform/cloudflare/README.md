# Cloudflare infrastructure

Terraform is the source of truth for private R2 application buckets, the
24-hour abandoned-upload lifecycle rule, and the analysis/dead-letter Queues.
Wrangler remains responsible for bundling and deploying Worker code, static
assets and the Container image because those artifacts change with each commit.

The Cloudflare provider and Terraform CLI are pinned in `versions.tf`. State is
stored in a separate private R2 bucket through Terraform's S3 backend. Creating
that state bucket and its narrow R2 access key is the one manual bootstrap step;
never use it for demos or derived artifacts.

CI initializes the backend with environment secrets. For a local plan, supply
equivalent values without writing them to tracked files:

```bash
terraform -chdir=infra/terraform/cloudflare init \
  -backend-config="bucket=<state-bucket>" \
  -backend-config="key=production/cloudflare.tfstate" \
  -backend-config="region=auto" \
  -backend-config="endpoint=https://<account-id>.r2.cloudflarestorage.com" \
  -backend-config="skip_credentials_validation=true" \
  -backend-config="skip_region_validation=true" \
  -backend-config="skip_requesting_account_id=true" \
  -backend-config="skip_metadata_api_check=true" \
  -backend-config="skip_s3_checksum=true" \
  -backend-config="use_path_style=true"
terraform -chdir=infra/terraform/cloudflare plan \
  -var="environment=production" \
  -var="cloudflare_account_id=<account-id>"
```

Use `queue_delivery_paused=true` as an emergency dispatch brake. It does not
delete queued metadata or source objects.
