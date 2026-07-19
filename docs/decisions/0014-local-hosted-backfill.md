# ADR 0014: Local compute with hosted artifact publication

- Status: accepted
- Date: 2026-07-20

## Context

Authorized demo sources can contain substantially more history than should be
parsed with hosted compute. Operators need a restartable manual path that
discovers and processes demos on an operator-controlled machine while making
the same compact reports available through the hosted Turso and R2 boundary.

## Decision

Add a local backfill application with source-specific discovery adapters and an
ignored SQLite checkpoint database. Discovery records source item identity,
publication time, sanitized URL metadata and an optional source game hint.
Items are scheduled by newest source game first and chronologically within a
source game. Source hints affect scheduling only. Canonical game association
continues to use the protected embedded server identity, stable roster,
campaign, chapter and adjacent server-generation evidence from ADR 0008.

Downloads reuse the allowlisted, bounded acquisition boundary. Compressed and
expanded bytes retain independent hashes and sizes. Expanded demos are stored
locally by content hash and analyzed through the production native parser child
with the production pseudonym key. Raw or compressed source bytes are never
uploaded by the backfill application.

The source-object limit is 100 MiB. Local expansion is bounded separately at
the native parser's 512 MiB hard input cap and a maximum 200:1 compression
ratio. This intentionally differs from the interactive hosted upload's 100 MiB
expanded limit: externally sourced `.dem.xz` recordings routinely expand past
that product boundary while remaining within the parser's accepted input.

Canonical result JSON is hashed, written to the private derived-artifact R2
bucket and verified by size and metadata. Only after verification does the
application create an idempotent `local-backfill` hosted job, record the result
reference and embedded game/player indexes in Turso, and mark it successful.
The hosted source record explicitly says the source was local and not uploaded.

Idempotency binds the expanded demo hash to parser build, configuration and
wire versions. The local source item database additionally prevents repeated
downloads after success and retains bounded retry state. Filenames and source
game identifiers are provenance and scheduling hints, never canonical game
identity.

## Consequences

- Parser CPU and raw-source retention remain local while hosted reports use the
  same artifact and metadata contracts as ordinary uploads.
- The operator machine holds identity-bearing runtime data and production
  credentials and must be protected accordingly.
- A matching production pseudonym key is required for cross-demo player and
  roster continuity. Losing or changing it creates unlinkable history.
- Source API changes fail closed until their adapter is updated and tested.
- Cron scheduling is intentionally outside this decision; the command is
  restartable and safe to invoke manually before automation is introduced.
