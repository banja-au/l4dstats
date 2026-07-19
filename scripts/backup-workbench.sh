#!/usr/bin/env bash
set -euo pipefail

backup_root=${1:-backups}
mkdir -p -- "$backup_root"
backup_root=$(cd "$backup_root" && pwd -P)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="l4dstats-workbench-${stamp}.tar.gz"

running=$(docker compose ps --status running --services 2>/dev/null || true)
restart_services=()
for service in api worker; do
  if grep -qx "$service" <<<"$running"; then
    restart_services+=("$service")
  fi
done

restore_services() {
  if ((${#restart_services[@]})); then
    docker compose start "${restart_services[@]}" >/dev/null
  fi
}
trap restore_services EXIT

if ((${#restart_services[@]})); then
  docker compose stop "${restart_services[@]}" >/dev/null
fi

docker compose run --rm --no-deps \
  -v "$backup_root:/backup" \
  api bash -euo pipefail -c \
  'test -f /var/lib/l4dstats/workbench.sqlite && tar -C /var/lib/l4dstats -czf "/backup/$1" .' \
  backup "$archive"

docker compose run --rm --no-deps \
  -v "$backup_root:/backup" \
  api bash -euo pipefail -c \
  'cd /backup && sha256sum "$1" > "$1.sha256"' \
  backup "$archive"

printf '%s\n' "$backup_root/$archive"
printf '%s\n' "$backup_root/$archive.sha256"
