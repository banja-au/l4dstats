# ADR 0009: Clean-room native Rust demo pipeline

- Status: accepted
- Date: 2026-07-18

## Context

At the time of this decision, the TypeScript protocol-2100 decoder was
deterministic and corpus validated, but
the production evidence path averages 100.71 seconds per 10–12 MiB demo on the
current Linux arm64 benchmark host. A CPU profile attributes 83.08 seconds of a
representative parse to entity reconstruction and L4D2 projection, including
repeated suffix scans over property maps, and 12.15 seconds to garbage
collection. Outer framing, userinfo, and events together are below one second.

No maintained, license-clear Rust, C, C++, or Zig parser is a drop-in for L4D2
Source 1 demo protocol 4 and network protocol 2100. Existing L4D2-capable native
projects without an explicit compatible license cannot be copied, linked, or
used derivatively. The Valve Source SDK remains a restrictive reference and its
implementation must not be copied.

The architecture already defines a versioned engine boundary so the decoder can
be replaced without changing the public API or reviewer UI.

## Decision

Build a repository-owned, clean-room Rust library for bounded Source 1 framing,
network messages, dynamic tables, events, entity reconstruction, and selective
L4D2 projection. The Rust implementation will:

1. accept demo bytes and an explicit bounded parser configuration;
2. traverse outer commands and network packets once;
3. borrow byte and bit ranges instead of copying them where possible;
4. resolve required L4D2 properties to numeric identifiers once per class;
5. retain bounded entity history and only the state needed by the versioned
   projection contract;
6. preserve tick as the primary coordinate, explicit missingness, unknown
   protocol diagnostics, privacy-safe identity epochs, and derivation lineage;
7. expose a deterministic internal `DemoProjectionArtifactV1` used for exact
   semantic differential testing against the then-current TypeScript oracle; and
8. run through one coarse native call inside the existing isolated parser child.

TypeScript initially continues to own statistics, competitive derivations,
detectors, ratings, explanations, and final evidence packaging. Browser, API,
storage, and final evidence contracts do not change merely because the parser is
native.

During migration, the TypeScript implementation remains the compatibility
oracle. Native output is accepted only after whole-corpus differential,
corruption/resource, determinism, and lineage gates pass. Exact parity means
semantic equality to the existing validated TypeScript behavior; it does not
claim independent licensed-game playback validation.

## Integration

The preferred production binding is Node-API loaded only inside the existing
sandboxed CLI parser process. It must accept bytes rather than paths and expose
no filesystem or network API. Node native-addon permission is enabled only for
that child. The process remains subject to no-network seccomp, read-only
container policy, wall/CPU/address-space/file-descriptor/output limits, process
group cancellation, and structured failure handling.

A standalone Rust CLI may exist for differential tests, fuzzing, and
benchmarks. It is not a second public product boundary.

## Consequences

- The repository gains a pinned Rust toolchain, Cargo dependency lock, license
  inventory, native build matrix, fuzz targets, and Rust quality commands.
- Real demos and identity-bearing parity artifacts remain ignored runtime data.
- Every parsing/statistics semantic change still requires `DEMO-DATA.md`,
  contracts, adapters, tests, and lineage to stay synchronized.
- Numeric property lookup, borrowed bit spans, and a single traversal are part
  of the design rather than optional post-port cleanup, because reproducing the
  measured TypeScript complexity would defeat the migration.
- Unsafe Rust is forbidden initially. Any future exception requires a separate
  measured ADR, a smaller audited boundary, and unchanged differential gates.
- Cross-demo parallelism remains an operational concern after per-demo latency
  and memory are measured; causally dependent entity deltas are not arbitrarily
  split across threads.

## Implementation addendum

The migration and differential gates are complete. The TypeScript decoder and
L4D2 projector have been removed; the Node-API binding is now the only demo
parser path, including in tests and development. Binding metadata version 2 binds
the core and binding versions, parser config ID, config/wire versions and a
64-hex build SHA. Production images compute and stamp a nonzero build SHA and
verify it before packaging the architecture-specific Node-API 8 addon.

The original compact transport was wire version 1 with parser config version 1.
Player-POV perspective and recorder-command support introduced wire version 2
with parser config version 2; both versions are intentionally incompatible. Strict
TypeScript rehydration and shared downstream packaging preserve explicit
missingness and provenance. All 22 authorized corpus demos matched the former
TypeScript `PreparedDemoProjection` semantics exactly before that implementation
was removed. A controlled five-demo
end-to-end run (one warmup, three alternating repetitions) measured a 53.816 s
native median versus 138.985 s for the former optimized TypeScript oracle
(2.583x),
with median peak RSS reduced from 1,988,496 KiB to 1,290,136 KiB. These are
historical migration measurements, not evidence of a currently selectable
TypeScript implementation. Production
Docker execution and browser E2E evidence remain separate exit gates and are
not claimed by this addendum.

Wire version 3 losslessly inherits unchanged L4D2 state within a player epoch.
It retains every observation and keeps the 256 MiB native output guard; `null`
in that private tuple position means repeat-prior-state and is rejected before
an epoch's first full state. This addresses player-POV artifacts whose repeated
full counter/state tuples exceeded the guard despite modest compressed demo
size. It does not change parser config version 2 or any public observation
contract.

The compact artifact builder constructs exactly one prepared demo view. It
performs one outer framing decode and caches one bounded network inspection per
packet/signon payload; identity, server metadata, entity projection, and event
projection share those results. A regression test counts prepared artifact
traversals and requires exactly one. Standalone diagnostic helpers retain
independent preparation wrappers and are not the production artifact path.

The prepared/artifact boundary returns structured `ProjectError` values.
Framing and protocol errors retain exact header offsets, network and event
errors retain the containing payload byte offset, and errors without a sound
byte location explicitly retain `null`. Stable stages distinguish framing,
network, projection, event schema/decode, and resource limits. The Node-API and
benchmark CLI preserve this classification rather than reclassifying strings.

## Rejected alternatives

- **Keep only TypeScript:** direct property indexing can materially improve it,
  but native selective state offers a larger latency and memory ceiling.
- **Adopt an existing unlicensed native parser:** legally and operationally
  unacceptable.
- **Copy Source SDK implementation:** prohibited by the project license
  boundary.
- **C or C++ clean-room core:** plausible runtime performance, but higher memory
  safety and hostile-input maintenance risk without a uniquely suitable
  licensed implementation.
- **Zig core:** no credible L4D2 parser or integration advantage offsets its
  additional ecosystem and maintenance risk.
- **Native HTTP service:** unnecessary deployment and transport complexity for
  the local workbench; the stable CLI/worker boundary already supplies process
  isolation.
