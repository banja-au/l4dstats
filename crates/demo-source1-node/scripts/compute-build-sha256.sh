#!/bin/sh
set -eu

repository_root=${1:-/workspace}
cd "$repository_root"

{ printf '%s\0' Cargo.toml Cargo.lock rust-toolchain.toml
  find crates -type f \( -name Cargo.toml -o -name '*.rs' \) -print0
} \
  | LC_ALL=C sort -z \
  | xargs -0 sha256sum \
  | sha256sum \
  | cut -d ' ' -f 1
