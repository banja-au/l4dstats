#!/usr/bin/env bash
set -euo pipefail

if (($# != 2)) || [[ $2 != "--confirm-restore" ]]; then
  printf 'Usage: %s <backup.tar.gz> --confirm-restore\n' "$0" >&2
  exit 64
fi

archive_input=$1
archive_dir=$(cd "$(dirname "$archive_input")" && pwd -P)
archive="$archive_dir/$(basename "$archive_input")"
checksum="$archive.sha256"
[[ -f $archive && -f $checksum ]] || {
  printf 'Backup and matching .sha256 file are required.\n' >&2
  exit 66
}

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

archive_name=$(basename "$archive")
docker compose run --rm --no-deps \
  -v "$archive_dir:/backup:ro" \
  api bash -euo pipefail -c '
    cd /backup
    sha256sum -c "$1.sha256"
    while IFS= read -r member; do
      case "$member" in
        /*|../*|*/../*|*/..) printf "Unsafe archive member: %s\n" "$member" >&2; exit 65 ;;
      esac
    done < <(tar -tzf "$1")
    while IFS= read -r listing; do
      case "${listing:0:1}" in
        -|d) ;;
        *) printf "Unsupported archive entry type: %s\n" "$listing" >&2; exit 65 ;;
      esac
    done < <(tar -tvzf "$1")
    safety="/tmp/l4dstats-pre-restore.tar.gz"
    tar -C /var/lib/witchwatch -czf "$safety" .
    find /var/lib/witchwatch -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    if ! tar --no-same-owner --no-same-permissions -C /var/lib/witchwatch -xzf "/backup/$1"; then
      find /var/lib/witchwatch -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
      tar -C /var/lib/witchwatch -xzf "$safety"
      exit 1
    fi
    test -f /var/lib/witchwatch/workbench.sqlite
  ' restore "$archive_name"

printf 'Restored %s\n' "$archive"
