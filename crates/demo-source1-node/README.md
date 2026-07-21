# Native Node binding

This unpublished Node-API addon exposes one coarse asynchronous operation over
caller-provided bytes. It has no filesystem or network API, no per-tick
callbacks, and no repository-owned unsafe code.

The crate uses `unsafe_code = "deny"` rather than the workspace's `forbid`:
`napi-derive` generates a registration shim containing a scoped lint override,
which Rust rejects beneath `forbid`. There are no unsafe blocks in this crate's
source; CI must retain the deny lint and audit generated/dependency versions.

The projection boundary is one call:

```text
projectDemo(demoBytes: Buffer, pseudonymKey: Buffer, configBytes: Buffer)
  -> Promise<compact artifact JSON Buffer v1>
```

All three inputs and the result are bytes so JavaScript object construction does
not dominate parsing. Config v2 is canonical UTF-8 JSON capped at 4 KiB, with
the exact field order in `index.d.ts`, no whitespace, unknown fields, duplicate
fields, or trailing data. Artifact serialization writes directly into a capped
Vec and cannot exceed 256 MiB. Parsing remains off the JavaScript event loop.

The addon checks demo length before its one defensive demo copy. The key is
restricted to 16–64 bytes and copied into the async task. Expected parser and
limit failures reject with `PROJECT_ERROR:` followed by deterministic ProjectError
v1 JSON. No demo path, key, or payload excerpt is included.

`bindingMetadata().buildSha256` is compiled from
`L4DSTATS_NATIVE_BUILD_SHA256`. The build script rejects malformed values;
local builds without the variable use an explicit 64-zero development marker.
Production computes a nonzero hash over the pinned Cargo manifests, lockfile,
toolchain, and Rust crate sources before compiling both the stage executable and
addon from the same workspace invocation.

Dependencies are exactly pinned:

- `napi 3.10.5` — MIT
- `napi-derive 3.5.10` — MIT
- `napi-build 2.3.2` — MIT

These releases require Rust 1.88 or newer; the repository pins Rust 1.97.1.
Build with `node scripts/build.mjs`, then run `node test/load.test.mjs`.
