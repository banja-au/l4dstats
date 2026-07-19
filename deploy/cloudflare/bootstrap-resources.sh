#!/bin/sh
set -eu

environment="${1:-}"
case "$environment" in
  staging|production) ;;
  *)
    printf '%s\n' "usage: $0 staging|production" >&2
    exit 64
    ;;
esac

command -v pnpm >/dev/null 2>&1 || {
  printf '%s\n' "pnpm is required" >&2
  exit 69
}

temporary_bucket="witchwatch-$environment-temporary"
artifact_bucket="witchwatch-$environment-artifacts"
analysis_queue="witchwatch-$environment-analysis"
dead_letter_queue="witchwatch-$environment-analysis-dlq"

if [ "${WITCHWATCH_APPLY_CLOUDFLARE:-}" != "yes" ]; then
  printf '%s\n' "Dry run. Set WITCHWATCH_APPLY_CLOUDFLARE=yes to create these resources:"
  printf '  R2 bucket: %s (private, one-day expiry)\n' "$temporary_bucket"
  printf '  R2 bucket: %s (private)\n' "$artifact_bucket"
  printf '  Queue: %s\n' "$analysis_queue"
  printf '  Queue: %s\n' "$dead_letter_queue"
  exit 0
fi

pnpm dlx wrangler@4 r2 bucket create "$temporary_bucket"
pnpm dlx wrangler@4 r2 bucket lifecycle add "$temporary_bucket" \
  --name delete-raw-demos-after-one-day \
  --expire-days 1
pnpm dlx wrangler@4 r2 bucket create "$artifact_bucket"
pnpm dlx wrangler@4 queues create "$analysis_queue"
pnpm dlx wrangler@4 queues create "$dead_letter_queue"

printf '%s\n' "Created Cloudflare resources for $environment. Buckets remain private."
