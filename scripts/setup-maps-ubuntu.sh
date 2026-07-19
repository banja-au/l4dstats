#!/usr/bin/env bash

set -euo pipefail

readonly expected_machine="x86_64"
readonly expected_dpkg_arch="amd64"

fail() {
  echo "setup-maps-ubuntu: $*" >&2
  exit 1
}

if [[ "$(id -u)" -ne 0 ]]; then
  fail "run this script as root (for example: sudo ./scripts/setup-maps-ubuntu.sh)"
fi

if [[ "$(uname -m)" != "$expected_machine" ]]; then
  fail "SteamCMD requires an x86-64 Ubuntu host; found $(uname -m)"
fi

if [[ ! -r /etc/os-release ]]; then
  fail "/etc/os-release is unavailable"
fi

# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  fail "this installer supports Ubuntu only; found ${ID:-unknown}"
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

if [[ ! -f compose.yaml || ! -f package.json ]]; then
  fail "run the copy of this script from a complete L4DStats checkout"
fi

export DEBIAN_FRONTEND=noninteractive

install_docker() {
  apt-get update
  apt-get install -y ca-certificates curl

  install -m 0755 -d /etc/apt/keyrings
  curl --fail --silent --show-error --location \
    https://download.docker.com/linux/ubuntu/gpg \
    --output /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  local ubuntu_codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "$ubuntu_codename" ]] || fail "Ubuntu release codename is unavailable"
  [[ "$(dpkg --print-architecture)" == "$expected_dpkg_arch" ]] || \
    fail "expected dpkg architecture amd64"

  printf '%s\n' \
    "deb [arch=${expected_dpkg_arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${ubuntu_codename} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
}

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install_docker
fi

systemctl enable --now docker
docker info >/dev/null
docker compose version

docker_root="$(docker info --format '{{.DockerRootDir}}')"
[[ -d "$docker_root" ]] || fail "Docker storage root is unavailable: $docker_root"
available_kib="$(df --output=avail -k "$docker_root" | tail -n 1 | tr -d '[:space:]')"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]]; then
  fail "could not determine free Docker storage"
fi
if (( available_kib < 25 * 1024 * 1024 )); then
  fail "at least 25 GiB free under $docker_root is required"
fi

echo "Installing or validating the pinned L4D2 dedicated-server assets..."
docker compose --profile maps run --rm maps-install

echo "Extracting provenance-stamped official map geometry..."
docker compose --profile maps run --rm maps-extract

echo "Checking the local geometry catalog..."
docker compose --profile maps run --rm maps-extract bash -lc '
  set -euo pipefail
  geometry=/var/lib/l4dstats/geometry
  test -s "$geometry/catalog.json"
  artifact_count="$(find "$geometry" -maxdepth 1 -type f -name "*.json" | wc -l)"
  if [[ "$artifact_count" -ne 58 ]]; then
    echo "expected 57 map artifacts plus catalog.json; found $artifact_count JSON files" >&2
    exit 1
  fi
  du -sh "$geometry"
'

echo "Map installation and extraction are complete."
echo "Rerunning this script is safe: SteamCMD validates its volume and extraction refreshes the local catalog."
