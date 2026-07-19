#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

docker compose --profile maps run --rm maps-extract bash -lc '
  set -euo pipefail

  source_root=/var/lib/l4dstats/geometry
  destination_root=/workspace/map-geometry
  expected_json_count=58

  test -s "$source_root/catalog.json"
  source_count="$(find "$source_root" -maxdepth 1 -type f -name "*.json" | wc -l)"
  if [[ "$source_count" -ne "$expected_json_count" ]]; then
    echo "expected 57 map meshes plus catalog.json; found $source_count JSON files" >&2
    exit 1
  fi

  mkdir -p "$destination_root"
  find "$source_root" -maxdepth 1 -type f -name "*.json" -exec cp --preserve=mode,timestamps -- {} "$destination_root/" \;

  destination_count="$(find "$destination_root" -maxdepth 1 -type f -name "*.json" | wc -l)"
  if [[ "$destination_count" -ne "$expected_json_count" ]]; then
    echo "expected $expected_json_count exported JSON files; found $destination_count" >&2
    exit 1
  fi

  echo "Exported 57 official map meshes plus catalog.json to $destination_root"
  du -sh "$destination_root"
'

git status --short -- map-geometry
