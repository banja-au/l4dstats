# ADR 0006: Local SQLite workbench and content-addressed artifacts

- Status: accepted
- Date: 2026-07-17

## Decision

Use Node 24's built-in SQLite binding for durable local job, case, note, telemetry-index, and audit metadata. Store large source and derived objects outside the database under `sha256/<prefix>/<hash>`. Expose bounded tick windows rather than whole observation artifacts.

The first worker is a single-process polling state machine. Jobs are created with a caller-supplied idempotency key, claimed transactionally, and may move through explicit cancel, failure, and retry transitions. Redis, an ORM, and a multi-worker queue are deferred until measured concurrency requires them.

## Security boundaries

Remote inputs require HTTPS and an exact/subdomain host allowlist. Local inputs must resolve beneath configured inbox roots, be regular `.dem` files within a byte limit, and are hashed before enqueue. Acquisition remains responsible for redirect, timeout, archive-entry, traversal, and decompression limits before any archive content enters this metadata layer.

## Consequences

- SQLite files, demos, player identifiers, and generated reports remain runtime data and are never committed.
- Audit events cover reviewer and job state changes; Sprint 5 may add tamper-evident chaining and authentication.
- Report JSON is canonically serialized and SHA-256 verifiable, while volatile export timestamps are deliberately excluded.
- Browser APIs enforce pagination and tick-span limits and never return complete telemetry artifacts.
- Telemetry storage rejects chunks above 600 ticks or 256 KiB. Range reads clip tick-addressed records to the requested half-open interval and reject responses above 16 chunks or 512 KiB.
- Progress streams stay open until the job enters a terminal state or the client disconnects. On startup, workers can requeue expired running leases; exhausted jobs fail after the configured attempt cap instead of looping forever.
