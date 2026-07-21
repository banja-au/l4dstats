#!/bin/sh
set -eu

environment="${1:-}"
entrypoint="${2:-}"
domain="${3:-}"
container_max_instances="${4:-${L4DSTATS_CONTAINER_MAX_INSTANCES:-}}"
container_instance_type="${5:-${L4DSTATS_CONTAINER_INSTANCE_TYPE:-}}"
case "$environment" in
  staging|production) ;;
  *)
    printf '%s\n' "usage: $0 staging|production path/to/hosted-dispatcher.ts hostname" >&2
    exit 64
    ;;
esac

if [ -z "$entrypoint" ] || [ ! -f "$entrypoint" ]; then
  printf '%s\n' "Hosted dispatcher entrypoint does not exist: $entrypoint" >&2
  exit 66
fi
case "$container_max_instances" in
  ''|*[!0-9]*)
    printf '%s\n' "Container max instances must be a positive integer" >&2
    exit 64
    ;;
esac
if [ "$container_max_instances" -lt 1 ] || [ "$container_max_instances" -gt 50 ]; then
  printf '%s\n' "Container max instances must be between 1 and 50" >&2
  exit 64
fi
case "$container_instance_type" in
  standard-2|standard-3|standard-4) ;;
  *)
    printf '%s\n' "Container instance type must be standard-2, standard-3, or standard-4" >&2
    exit 64
    ;;
esac
if [ -z "$domain" ] || printf '%s' "$domain" | grep -q '[/:[:space:]]'; then
  printf '%s\n' "Hosted domain must be a bare hostname" >&2
  exit 64
fi

output="deploy/cloudflare/wrangler.$environment.jsonc"
if [ -e "$output" ]; then
  printf '%s\n' "Refusing to overwrite $output" >&2
  exit 73
fi

sed \
  -e "s/__ENV__/$environment/g" \
  -e "s|HOSTED_DISPATCHER_ENTRYPOINT|../../$entrypoint|g" \
  -e "s/HOSTED_DOMAIN/$domain/g" \
  -e "s/\"__CONTAINER_MAX_INSTANCES__\"/$container_max_instances/g" \
  -e "s/__CONTAINER_INSTANCE_TYPE__/$container_instance_type/g" \
  deploy/cloudflare/wrangler.template.jsonc > "$output"

printf '%s\n' "Rendered $output"
printf '%s\n' "Set TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, and application secrets with wrangler secret put before deployment."
