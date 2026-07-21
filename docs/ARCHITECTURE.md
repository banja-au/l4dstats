# Architecture

## Principles

The core is a deterministic pipeline behind a stable CLI/contract. UI, transport, and storage remain replaceable. Every stage emits quality metadata and provenance. Large time series are chunked artifacts, not relational rows.

## Target flow

1. **Discover** a file or allowlisted archive URL without downloading the entire index into memory.
2. **Acquire** with redirects, timeouts, byte caps, ZIP entry/path/ratio caps, SHA-256 hashing, deduplication, and an immutable manifest.
3. **Decode** Source 1 framing and messages; retain unknown message metadata.
4. **Project** dynamic send tables, string tables, entities, events, and player epochs through an L4D2 schema adapter.
5. **Normalize** to versioned observations keyed by demo hash and tick. Store tick and demo time.
6. **Detect** independent event windows. Each detector emits features, quality, explanation, limitation, counterevidence, and version.
7. **Aggregate** correlated ticks into encounters, then demos, then player history. Cap detector/encounter influence and calibrate on held-out players/time.
8. **Review** via range queries, timeline, 2D tactical reconstruction, and immutable report manifests.

## Boundaries

```text
apps/web  ─HTTP/SSE─► apps/api ─job─► engine CLI
   ▲                      │              │
   │ range queries        ▼              ▼
   └────────────── SQLite metadata + content-addressed artifacts

engine CLI = decoder → L4D2 projection → observations → detectors → scoring
```

The production engine uses a clean-room Rust decoder through one asynchronous,
coarse Node-API call. The addon accepts demo bytes, a privacy key and canonical
bounded configuration; it exposes no path or network API. It returns compact
wire v2, which a strict TypeScript adapter rehydrates before the existing
statistics, detectors and evidence packaging run. The versioned CLI/JSON
boundary keeps API, storage and UI contracts independent of parser language.
The Rust core is the only demo decoder and L4D2 projector. TypeScript retains the
strict wire adapter and downstream statistics, detector and evidence packaging;
there is no alternate parser or fallback path.

Artifact production uses one `PreparedDemo`: outer command framing is decoded
once and packet message boundaries are inspected once, then shared by identity,
server-info, entity, and event consumers. Public diagnostic helpers may create
their own prepared view when invoked independently. Native failures cross the
binding as a stable typed envelope with stage and the best defensible byte
offset; unavailable offsets remain explicit rather than inferred.

The addon is loaded only inside the parser child. That child has exact
demo/application read permissions, no-network seccomp, a read-only production
filesystem, rlimits, bounded output and process-group cancellation. Node's
permission model does not constrain syscalls made by an addon, so native addon
permission is not granted to the API, worker or web processes.

Hosted browser acquisition also accepts one raw `.dem` or one explicitly named
single-demo ZIP archive (`.zip`) or compressed stream (`.dem.gz`, `.dem.xz`, `.dem.bz2`, or
`.dem.zst`). Expansion happens in the networking parent before the parser child,
with suffix/magic agreement, member/path/type checks, compressed and expanded
byte caps, a ratio cap and bounded decoder execution. No archive path is ever
materialized. The uploaded-object hash and the independently calculated
expanded-demo hash are distinct provenance fields. See ADR 0011.

The hosted developer console is a separate React/Tailwind asset bundle served
by the same Worker at `developers.l4dstats.gg`. Its API-key boundary creates up
to ten account-owned upload grants and then reuses the exact browser R2, Queue,
Container and delete-after-extraction transaction. Turso stores salted password
hashes, hashed API keys, sessions, atomic UTC-day quotas and bounded request
logs; API clients cannot address another account's jobs. See ADR 0013.

## Canonical concepts

- `Demo`: hash, origin, acquisition manifest, header, protocol, map, quality.
- `PlayerEpoch`: stable platform ID when available plus connection interval and demo-local identity.
- `ObservationChunk`: tick-ranged poses, angles, states, events, and availability bitmap.
- `Encounter`: one causal play episode; the unit that prevents tick pseudoreplication.
- `EvidenceEvent`: detector output with contribution and counterevidence.
- `ReviewScore`: calibrated review priority, data quality, sample count, label, model version.
- `ReportManifest`: immutable references to all source and derived hashes.

## Storage

SQLite stores jobs, metadata, indexes, findings, reviews, and audit events. Raw archives/demos, observation chunks, reports, and clips live under `sha256/aa/<hash>` through a storage interface. Production may replace these with PostgreSQL and S3-compatible storage. Redis/BullMQ is deferred until multiple workers make it necessary.

The proposed hosted boundary in ADR 0010 preserves local SQLite/Compose while
adding asynchronous Turso metadata, private R2 objects, an at-least-once Queue,
and bounded native parser Containers. Hosted raw demos are staging objects:
after derived objects and their lineage are verified and committed, deletion of
the source must be confirmed before the job becomes successful. Large result
and telemetry JSON stays out of Turso. Cloudflare placement is provider-selected
and does not guarantee Los Angeles execution.

The operator backfill path in ADR 0014 replaces hosted parser compute with a
restartable local discovery and native-parser application. Raw source and
expanded demos remain in an ignored local content-addressed store. The
application uploads verified result JSON directly to the private derived R2
bucket, then commits compact Turso references and invokes the same embedded
game/player association logic. Source-provided game IDs and filenames may
prioritize work but never override canonical session evidence.

The hidden aggregate statistics route reads bounded counts, recent games, and
player-frequency rankings directly from hosted Turso indexes. Versioned,
per-demo materializations retain signal counts and the rating inputs required
to derive career summaries without repeatedly downloading result artifacts.
The restartable stats backfill verifies every derived artifact before repairing
historical player/game indexes and writing those rows. Aggregate signal totals
are published only when every hosted analysis has the current materialization;
otherwise they remain explicitly unavailable. Career ratings use the shared
rating package and remain unavailable until the documented eligibility and
cohort requirements are met.

## Visualization ladder

1. Tick timeline and detector lanes.
2. Canvas 2D map with poses, trails, FOV, shot rays, LOS, and floor controls.
3. Optional lazy-loaded analytical 3D reconstruction.
4. Optional game-render worker for authentic clips, clearly labeled with render provenance.

Analytical reconstruction is not authentic game footage. Exact pixels require compatible game binaries/assets and may reflect observer rather than player POV.
