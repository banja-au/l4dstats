#!/bin/sh
set -eu

hosted_entrypoint="${WITCHWATCH_HOSTED_WORKER_ENTRYPOINT:-/workspace/apps/worker/dist/hosted-main.js}"

if [ ! -f "$hosted_entrypoint" ]; then
  printf '%s\n' "Hosted worker entrypoint is absent: $hosted_entrypoint" >&2
  printf '%s\n' "The local SQLite worker is intentionally not started in Cloudflare Containers." >&2
  exit 78
fi

if [ -z "${TURSO_DATABASE_URL:-}" ] || [ -z "${TURSO_AUTH_TOKEN:-}" ]; then
  printf '%s\n' "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required" >&2
  exit 78
fi

exec node "$hosted_entrypoint" "$@"
