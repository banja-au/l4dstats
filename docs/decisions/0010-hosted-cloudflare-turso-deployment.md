# ADR 0010: Hosted Cloudflare and Turso deployment

- Status: proposed
- Date: 2026-07-19

## Context

The accepted local deployment keeps SQLite, source demos, derived artifacts and
the worker on one persistent filesystem. That is simple and remains the
reference deployment, but it prevents independent scaling of the web/API and
native parser. The hosted workload may reach 100,000 demos per month, while the
operator does not want to administer a VPS or general-purpose cloud account.

Raw demos contain player identifiers and can be materially larger than the
compact report. The hosted product does not need a source demo to display an
already-produced report. It does need the source to reproduce parsing or derive
new fields later. This is a deliberate storage, privacy and reproducibility
tradeoff rather than an implementation detail.

The parser is the repository-owned Rust Node-API pipeline described by ADR 0009.
It requires a Linux process, native addon support, bounded temporary disk and
substantially more memory and CPU time than a Cloudflare Worker isolate. A
Cloudflare Container can provide that runtime, but its disk is ephemeral and its
placement is not a Los Angeles guarantee.

## Decision

Add an optional hosted deployment with these boundaries:

1. Cloudflare Worker static assets serve the built web application. Keeping the
   assets and API on one custom domain preserves the existing relative `/api`
   contract; a future split to Pages must prove equivalent routing.
2. A Cloudflare Worker authenticates requests, creates bounded upload grants,
   exposes API/status endpoints and publishes parse jobs.
3. Cloudflare R2 Standard stores private temporary source objects and private,
   content-addressed derived artifacts. Source and derived data use separate
   buckets or independently enforceable prefixes.
4. Cloudflare Queues delivers parse jobs at least once. Every message carries a
   stable idempotency key; Turso job state and leases prevent duplicate
   completion from producing conflicting results.
5. Cloudflare Containers run the compiled Node 24 and Rust parser worker. The
   container downloads only the claimed source into bounded ephemeral storage,
   independently hashes it, writes derived objects, commits their references and
   lineage, and removes all local source copies.
6. Turso stores compact relational metadata: job and lease state, review state,
   indexes, audit events, hashes, artifact keys, sizes, schema/producer versions,
   tick ranges, explicit availability and derivation lineage. Observation
   chunks, report payloads and other large immutable JSON belong in R2, not
   relational rows.
7. A successful parse deletes its R2 source before the job becomes terminally
   successful. An R2 lifecycle rule deletes abandoned temporary sources as a
   backstop; lifecycle cleanup is not the normal success path.
8. Local SQLite plus filesystem/Compose mode remains supported. Hosted storage
   is introduced behind asynchronous, narrow metadata and object-store
   interfaces; detector, rating and canonical observation logic does not know
   about HTTP, Turso, R2 or Queues.

The initial Container size is `standard-2` (1 vCPU, 6 GiB memory and 12 GB
ephemeral disk), subject to an actual representative benchmark. Concurrency is
bounded explicitly. Queue depth may request capacity only up to the configured
cost and safety ceiling.

## Source deletion and completion protocol

The source object is staging data, not a durable artifact. A job may be reported
as successful only after:

1. the parser calculates and records the source SHA-256;
2. every required derived object is durably written and its hash, byte size,
   contract version and producer lineage are verified;
3. Turso durably records the immutable artifact references and final analysis
   state;
4. the temporary R2 source is deleted and deletion is confirmed; and
5. the worker removes its ephemeral working copy.

The implementation must define a recoverable intermediate state for the narrow
case where metadata commit succeeds but source deletion initially fails. It must
retry deletion idempotently, keep the report unavailable as a completed result,
and alert if a successful analysis has a source object older than one hour.
Duplicate Queue delivery and expired leases must never rewrite an accepted
artifact or its lineage.

Failed and cancelled work deletes its source immediately where possible. The
temporary bucket lifecycle expires any orphan no later than the configured
backstop, initially 24 hours. Operators and application logs retain only job and
content hashes needed for diagnosis, not filenames, source bytes, player names
or signed object URLs.

## Reanalysis and evidence consequences

After deletion, an existing report remains inspectable and hash-verifiable, but
the parser cannot be rerun from hosted storage. The UI and exports must say
`source demo unavailable (deleted after extraction)` and must not imply full
source reproducibility. One-click reanalysis becomes a request to upload the
source again. The uploaded bytes must match the recorded SHA-256 before they can
be associated with the prior analysis; a mismatch is a different source.

The durable record continues to preserve source hash and origin metadata,
parser/detector/model versions, configuration, map asset version, artifact
hashes, availability and complete derivation lineage. Purged detailed telemetry
is explicitly unavailable and is never rendered as zero. Compact reports and
provenance may have a different retention period from detailed telemetry.

## Security and reliability boundaries

- R2 buckets are private. Upload grants authorize one operation on one
  unpredictable object key, expire quickly and are treated as bearer secrets.
  Browser upload CORS allows only the production and staging origins.
- Upload completion is not trusted until the worker independently enforces the
  byte cap, extension/content contract and SHA-256. Remote/archive ingestion
  retains the allowlist, timeout, traversal and decompression-bomb controls.
- Turso job claims, lease renewal, completion and attempt exhaustion are atomic
  and tested with concurrent workers. Progress writes are throttled; telemetry
  is never written row by row.
- The parser child retains the existing bytes-only native boundary, provenance
  validation, no-network policy where supported, rlimits, wall/output limits and
  process-group cleanup. The networking parent receives secrets; the parser
  child does not.
- Staging and production use separate Turso databases, R2 buckets, Queues,
  Container namespaces, Worker services and secrets.
- Cloudflare Queue delivery is at least once, so idempotency is mandatory rather
  than optional.

## Placement, capacity and cost caveats

Cloudflare distributes the image globally and selects a nearby available
Container location. A stopped instance can restart elsewhere. This deployment
therefore does **not** guarantee Los Angeles execution or data residency. If LA
placement becomes mandatory, retain the Turso/R2 boundaries and replace the
Container pool with bounded compute explicitly pinned to LA.

Cloudflare Containers require Workers Paid. Container memory, CPU and ephemeral
disk are usage-billed after included allowances; idle-time policy and image
startup affect cost. R2 charges for retained GB-months and operations, while
deletes are free. Turso free-tier capacity is a launch convenience, not a scale
assumption. No monthly cost is accepted from estimates alone at 100,000 demos:
a 1,000-demo then 10,000-demo production-shaped benchmark must measure parser
wall/CPU time, peak memory, cold starts, source and derived bytes, R2 operations,
Turso bytes, reads and writes per demo. A hard concurrency ceiling, provider
budgets and alerts are required before public ingestion.

## Rollout gates

1. Preserve local behavior behind asynchronous metadata/object interfaces.
2. Prove Turso atomic claims, leases, duplicate delivery and crash recovery.
3. Prove R2 direct upload, derived-object verification and source deletion,
   including every commit/delete failure ordering.
4. Run the actual production image against golden, corrupt, oversized and
   timeout fixtures.
5. Complete one authenticated browser-to-report flow in isolated staging.
6. Run 100-, 1,000- and 10,000-demo soaks and publish measurement artifacts
   without demos or identifiers.
7. Set production concurrency and spend limits from those measurements.
8. Enable production ingestion gradually and observe queue age, failures,
   source cleanup and cost before increasing traffic.

Hosted deployment remains withheld if raw-source cleanup is not demonstrably
reliable, if cost cannot be bounded, or if the hosted parser weakens the accepted
native sandbox boundary without a documented risk decision.

## Consequences

- Web/API and native parsing can scale independently without a shared local
  filesystem, and parser compute can sleep when no work exists.
- Raw demo retention and its storage growth are eliminated from the normal
  hosted lifecycle.
- Reanalysis requires the user to possess and re-upload the exact source.
- Async storage adapters and distributed failure handling add meaningful code
  and operational complexity.
- Derived telemetry can still dominate retained storage, so it requires an
  explicit policy and measured size budget.
- The accepted local deployment remains the reproducible option when retaining
  source demos is required.
- Terraform manages durable Cloudflare buckets, lifecycle rules and Queues.
  Wrangler packages and deploys the commit-specific Worker, static assets and
  Container image because those build artifacts are not durable infrastructure.

## References

- [Cloudflare Containers lifecycle and ephemeral disk](https://developers.cloudflare.com/containers/platform-details/architecture/)
- [Cloudflare Container instance types](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Cloudflare Workers and Containers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Turso documentation](https://docs.turso.tech/)
