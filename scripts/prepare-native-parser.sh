#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

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
