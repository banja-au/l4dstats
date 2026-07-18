#!/usr/bin/env bash
set -euo pipefail

if (($# < 1 || $# > 2)) || [[ ! $1 =~ ^[0-9]+$ ]] || ((10#$1 < 1 || 10#$1 > 3650)); then
  printf 'Usage: %s <days:1-3650> [--confirm-purge]\n' "$0" >&2
  exit 64
fi
days=$1
mode=preview
if (($# == 2)); then
  [[ $2 == "--confirm-purge" ]] || {
    printf 'The only accepted confirmation is --confirm-purge.\n' >&2
    exit 64
  }
  mode=purge
fi

running=$(docker compose ps --status running --services 2>/dev/null || true)
restart_services=()
if [[ $mode == purge ]]; then
  for service in api worker; do
    if grep -qx "$service" <<<"$running"; then
      restart_services+=("$service")
    fi
  done
fi

restore_services() {
  if ((${#restart_services[@]})); then
    docker compose start "${restart_services[@]}" >/dev/null
  fi
}
trap restore_services EXIT

if ((${#restart_services[@]})); then
  docker compose stop "${restart_services[@]}" >/dev/null
fi

args=(src/retention.ts "$mode" "$days")
if [[ $mode == purge ]]; then
  args+=(--confirm-purge)
fi
docker compose run --rm --no-deps api \
  pnpm --filter @witchwatch/api exec tsx "${args[@]}"
