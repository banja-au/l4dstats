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

The initial engine may be TypeScript. The boundary is a versioned CLI and NDJSON/JSON schema so a later Rust decoder does not disturb the API or UI.

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

## Visualization ladder

1. Tick timeline and detector lanes.
2. Canvas 2D map with poses, trails, FOV, shot rays, LOS, and floor controls.
3. Optional lazy-loaded analytical 3D reconstruction.
4. Optional game-render worker for authentic clips, clearly labeled with render provenance.

Analytical reconstruction is not authentic game footage. Exact pixels require compatible game binaries/assets and may reflect observer rather than player POV.
