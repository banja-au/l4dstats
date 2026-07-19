#!/usr/bin/env bash

set -Eeuo pipefail

readonly NODE_MAJOR="24"
readonly RUST_TOOLCHAIN="1.97.1"
readonly NVM_VERSION="v0.40.3"
SETUP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SETUP_ROOT

log() {
  printf '\n\033[1;32m[l4dstats:setup]\033[0m %s\n' "$*"
}

die() {
  printf '\n\033[1;31m[l4dstats:setup]\033[0m %s\n' "$*" >&2
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
    log "Installing Debian/Ubuntu build and demo-processing dependencies"
    run_as_root apt-get update
    run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential \
      bzip2 \
      ca-certificates \
      curl \
      git \
      pkg-config \
      shellcheck \
      unzip \
      util-linux \
      xz-utils
  elif command -v apk >/dev/null 2>&1; then
    log "Installing Alpine build and demo-processing dependencies"
    run_as_root apk add --no-cache \
      bash \
      build-base \
      bzip2 \
      ca-certificates \
      curl \
      git \
      pkgconf \
      shellcheck \
      unzip \
      util-linux \
      xz
  else
    log "No supported package manager found; checking existing host tools"
  fi
  for command_name in curl git cc xz bzip2 prlimit; do
    command -v "${command_name}" >/dev/null 2>&1 || die "Missing required command: ${command_name}"
  done
}

ensure_rust() {
  export CARGO_HOME="${CARGO_HOME:-${HOME}/.cargo}"
  export RUSTUP_HOME="${RUSTUP_HOME:-${HOME}/.rustup}"
  export PATH="${CARGO_HOME}/bin:${PATH}"
  if ! command -v rustup >/dev/null 2>&1; then
    log "Installing rustup without changing the interactive shell profile"
    curl --proto '=https' --tlsv1.2 --fail --show-error --silent \
      https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal
  fi
  log "Installing pinned Rust ${RUST_TOOLCHAIN} with clippy and rustfmt"
  rustup toolchain install "${RUST_TOOLCHAIN}" \
    --profile minimal \
    --component clippy,rustfmt
  rustup override set "${RUST_TOOLCHAIN}" --path "${SETUP_ROOT}"
  cargo --version
  rustc --version
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

ensure_workspace() {
  log "Enabling the package manager pinned in package.json"
  corepack enable
  corepack install
  cd "${SETUP_ROOT}"
  pnpm install --frozen-lockfile
  if [[ "${SKIP_NATIVE_BUILD:-0}" != "1" ]]; then
    log "Building and attesting the native parser"
    CARGO_HOME="${CARGO_HOME}" RUSTUP_HOME="${RUSTUP_HOME}" pnpm native:prepare
  else
    log "Skipping native parser build because SKIP_NATIVE_BUILD=1"
  fi
}

verify() {
  if [[ "${RUN_CHECKS:-0}" != "1" ]]; then
    log "Skipping the full quality gate; run with RUN_CHECKS=1 to enable it"
    return
  fi
  log "Running the repository quality gate"
  shellcheck "${SETUP_ROOT}/setup.sh" "${SETUP_ROOT}/scripts/prepare-native-parser.sh"
  pnpm format:check
  pnpm check
  pnpm test
  pnpm build
}

main() {
  install_system_dependencies
  ensure_rust
  ensure_node
  ensure_workspace
  verify
  log "Setup complete. Reload your shell (or run 'direnv allow'), then run: pnpm backfill --concurrency 2 --max-demos 20"
}

main "$@"
