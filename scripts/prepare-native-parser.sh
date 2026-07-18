#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

# Compose starts services through a login shell, whose system profile may
# replace the image PATH. Resolve the copied Rust toolchain independently of
# the caller's shell initialization.
native_cargo_home="${CARGO_HOME:-/usr/local/cargo}"
export PATH="${native_cargo_home}/bin:${PATH}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is unavailable at ${native_cargo_home}/bin" >&2
  exit 1
fi

native_build_sha256="$(crates/demo-source1-node/scripts/compute-build-sha256.sh "$repository_root")"
if [[ ! "$native_build_sha256" =~ ^[a-f0-9]{64}$ ]] || [[ "$native_build_sha256" =~ ^0{64}$ ]]; then
  echo "native parser build digest is invalid" >&2
  exit 1
fi

WITCHWATCH_NATIVE_BUILD_SHA256="$native_build_sha256" \
  cargo build --locked --release --package demo-source1-node
node crates/demo-source1-node/scripts/build.mjs --copy-only
WITCHWATCH_EXPECT_NATIVE_BUILD_SHA256="$native_build_sha256" \
  node crates/demo-source1-node/test/lineage.test.mjs
