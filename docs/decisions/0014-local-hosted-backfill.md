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
publication time, sanitized URL metadata and an optional provider-issued source
game key. Source games must remain unchanged for a default 60-minute settlement
window before selection. `--max-demos` is a target cap and never splits one
source game. Items are scheduled by newest settled source game first and
chronologically within a source game.

After every catalog member succeeds, the publisher finalizes the provider group
as one hosted game. Embedded server, stable-roster, campaign, chapter and
generation evidence from ADR 0008 remains retained independently. A provider
group may join same-chapter segments that embedded-only reconstruction keeps
separate, but conflicting embedded campaigns fail closed. The game evidence is
stamped `external-source-group:<source>` and remains provisional unless the
ordinary embedded rules independently justify high confidence. A quiet window
is an ingestion-stability heuristic, not proof that a played match reached its
intended final chapter.

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

Game merges retain aliases from every replaced UUID to the surviving game.
Previously issued `/game/:id` URLs therefore remain resolvable after later
chapters or source finalization consolidate provisional games.

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
