# Third-party and reference inventory

| Component                                                                         | Use                                       | License/status                                                     | Decision                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`saul/demofile`](https://github.com/saul/demofile)                               | Parser research                           | MIT; archived 2026-04-28                                           | Not adopted; CS:GO-specific protocol/model                                           |
| [`NeKzor/sdp`](https://github.com/NeKzor/sdp)                                     | Parser design research                    | MIT; commit tested `20a965958e64780718235ad150801a214150c276`      | Candidate reference only; L4D2 message parsing failed empirically                    |
| [`UncraftedName/UntitledParser`](https://github.com/UncraftedName/UntitledParser) | Independent L4D2 header/frame reference   | MIT; commit inspected `c7bd376e68cbf693071a652847eccb1d9d76eca7`   | Reference tooling; no L4D2 entity support                                            |
| [Valve Source SDK 2013](https://github.com/ValveSoftware/source-sdk-2013)         | Canonical public format/header reference  | Valve SDK license; redistribution restrictions                     | Consult behavior/header declarations only; do not copy implementation                |
| CEDAPug demo archive                                                              | Public test inputs                        | Publicly downloadable; redistribution terms not stated             | Keep raw ZIP/DEM ignored and local; track only provenance, hashes, minimized headers |
| [`snap`](https://github.com/BurntSushi/rust-snappy)                               | Native bounded Snappy decompression       | BSD-3-Clause; pinned `1.1.2`                                       | Rust runtime dependency behind compressed/output-size limits                         |
| [`sha2`](https://github.com/RustCrypto/hashes)                                    | Native demo and lineage SHA-256           | MIT OR Apache-2.0; pinned `0.11.0`                                 | Rust runtime dependency                                                              |
| [`hmac`](https://github.com/RustCrypto/MACs)                                      | Native privacy-safe identity tokenization | MIT OR Apache-2.0; pinned `0.13.0`                                 | Rust runtime dependency; secret key is never emitted                                 |
| [`hex`](https://github.com/KokaKiwi/rust-hex)                                     | Native digest encoding                    | MIT OR Apache-2.0; pinned `0.4.3`                                  | Rust runtime dependency                                                              |
| [`serde`](https://github.com/serde-rs/serde)                                      | Native compact artifact serialization     | MIT OR Apache-2.0; pinned `1.0.228`                                | Derive support only for the versioned parser transport                               |
| [`serde_json`](https://github.com/serde-rs/json)                                  | Native compact JSON envelope              | MIT OR Apache-2.0; pinned `1.0.150`                                | Streaming stage transport; observation values use compact positional rows            |
| [`libfuzzer-sys`](https://github.com/rust-fuzz/libfuzzer)                         | Native parser fuzz harness                | MIT OR Apache-2.0; pinned `0.4.13`                                 | Development-only synthetic fuzz targets; not linked into production artifacts        |
| [`napi-rs`](https://github.com/napi-rs/napi-rs)                                   | Bytes-only Node-API parser binding        | MIT; `napi` `3.10.5`, `napi-derive` `3.5.10`, `napi-build` `2.3.2` | Loaded only inside the isolated parser child; no path or network API                 |
| [`libloading`](https://github.com/nagisa/rust_libloading)                         | Node-API dynamic loading support          | ISC; transitively pinned `0.9.0`                                   | Reviewed transitive dependency of `napi-sys`                                         |
| [`unicode-ident`](https://github.com/dtolnay/unicode-ident)                       | Rust procedural-macro identifiers         | Unicode-3.0 AND (MIT OR Apache-2.0); transitively pinned `1.0.24`  | Reviewed build-time transitive dependency                                            |

Runtime JavaScript dependencies and their resolved licenses remain recorded by
`pnpm-lock.yaml`. `pnpm security:check` fails on known dependency
vulnerabilities or any license category outside the reviewed allowlist in
`scripts/check-licenses.mjs`. Cargo dependencies are exact-version pinned in
`Cargo.lock`; the same command runs `cargo deny check` to reject advisories,
duplicate or wildcard versions, unapproved licenses, and non-crates.io sources.
The current categories are Apache-2.0, BSD-3-Clause, BlueOak-1.0.0,
CC-BY-4.0, ISC, MIT, MPL-2.0, OFL-1.1 and Unicode-3.0.
Dependency approval does not select a license for this repository or establish
redistribution rights for local CEDAPug demos, Valve assets or extracted maps.
