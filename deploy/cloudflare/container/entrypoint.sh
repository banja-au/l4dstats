#!/bin/sh
set -eu

hosted_entrypoint="${L4DSTATS_HOSTED_WORKER_ENTRYPOINT:-/workspace/apps/worker/dist/hosted-main.js}"

if [ ! -f "$hosted_entrypoint" ]; then
  printf '%s\n' "Hosted worker entrypoint is absent: $hosted_entrypoint" >&2
  printf '%s\n' "The local SQLite worker is intentionally not started in Cloudflare Containers." >&2
  exit 78
fi

if [ -z "${L4DSTATS_PSEUDONYM_KEY:-}" ]; then
  printf '%s\n' "L4DSTATS_PSEUDONYM_KEY is required" >&2
  exit 78
fi

exec node "$hosted_entrypoint" "$@"
