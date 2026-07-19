#!/usr/bin/env bash

set -Eeuo pipefail

readonly NODE_MAJOR="24"
readonly NVM_VERSION="v0.40.3"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR

log() {
  printf '\n\033[1;32m[l4dstats:init]\033[0m %s\n' "$*"
}

die() {
  printf '\n\033[1;31m[l4dstats:init]\033[0m %s\n' "$*" >&2
  exit 1
}

run_as_root() {
  if [[ ${EUID} -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    die "Root privileges or sudo are required to install system packages."
  fi
}

install_system_dependencies() {
  if [[ "${SKIP_SYSTEM_DEPS:-0}" == "1" ]]; then
    log "Skipping system packages because SKIP_SYSTEM_DEPS=1"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing Debian/Ubuntu development dependencies"
    run_as_root apt-get update
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      shellcheck \
      unzip \
      xz-utils
  elif command -v apk >/dev/null 2>&1; then
    log "Installing Alpine development dependencies"
    run_as_root apk add --no-cache \
      bash \
      build-base \
      ca-certificates \
      curl \
      git \
      shellcheck \
      unzip \
      xz
  else
    log "No supported system package manager found; assuming base tools are installed"
  fi
}

node_major() {
  node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && [[ "$(node_major)" == "${NODE_MAJOR}" ]]; then
    log "Using Node $(node --version)"
    return
  fi

  log "Installing Node ${NODE_MAJOR} with nvm ${NVM_VERSION}"
  export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    curl --fail --show-error --silent --location \
      "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
  fi

  # shellcheck source=/dev/null
  source "${NVM_DIR}/nvm.sh"
  nvm install "${NODE_MAJOR}"
  nvm use "${NODE_MAJOR}"
}

ensure_pnpm() {
  log "Enabling the package manager pinned in package.json"
  corepack enable
  corepack install
  pnpm --version
}

install_workspace() {
  log "Installing the locked workspace"
  cd "${SCRIPT_DIR}"
  pnpm install --frozen-lockfile
  log "Installing the pinned Chromium browser used by Playwright"
  pnpm --filter @l4dstats/web exec playwright install chromium
}

verify_workspace() {
  if [[ "${SKIP_CHECKS:-0}" == "1" ]]; then
    log "Skipping verification because SKIP_CHECKS=1"
    return
  fi

  log "Running formatting, type, test, and production-build checks"
  shellcheck "${SCRIPT_DIR}/init.sh"
  pnpm format:check
  pnpm check
  pnpm test
  pnpm build
  pnpm test:e2e
}

main() {
  install_system_dependencies
  ensure_node
  ensure_pnpm
  install_workspace
  verify_workspace
  log "Ready. Run 'pnpm dev' and open http://localhost:5173"
}

main "$@"
