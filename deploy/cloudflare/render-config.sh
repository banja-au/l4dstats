#!/bin/sh
set -eu

environment="${1:-}"
entrypoint="${2:-}"
case "$environment" in
  staging|production) ;;
  *)
    printf '%s\n' "usage: $0 staging|production path/to/hosted-dispatcher.ts" >&2
    exit 64
    ;;
esac

if [ -z "$entrypoint" ] || [ ! -f "$entrypoint" ]; then
  printf '%s\n' "Hosted dispatcher entrypoint does not exist: $entrypoint" >&2
  exit 66
fi

output="deploy/cloudflare/wrangler.$environment.jsonc"
if [ -e "$output" ]; then
  printf '%s\n' "Refusing to overwrite $output" >&2
  exit 73
fi

sed \
  -e "s/ENVIRONMENT/$environment/g" \
  -e "s|HOSTED_DISPATCHER_ENTRYPOINT|$entrypoint|g" \
  deploy/cloudflare/wrangler.template.jsonc > "$output"

printf '%s\n' "Rendered $output"
printf '%s\n' "Set TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, and application secrets with wrangler secret put before deployment."
