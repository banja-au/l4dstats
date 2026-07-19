# Hosted Cloudflare and Turso operations

This is the deployment and operations checklist for the **proposed** hosted
architecture in ADR 0010. Commands, resource names and secret bindings must be
filled in by the implementation; this runbook does not claim that the current
repository can already be deployed to Cloudflare.

The local Compose deployment remains documented in
[local-workbench.md](local-workbench.md). Use it as the reference behavior and
recovery environment while hosted support is under construction.

## Responsibility split

The repository implementation and CI should create repeatable application
configuration, migrations, tests and deployments. An account owner must perform
the provider, billing, domain and identity actions that cannot safely be inferred
or committed.

| Boundary              | Hosted responsibility                                      |
| --------------------- | ---------------------------------------------------------- |
| Web                   | Cloudflare Worker static assets                            |
| API and upload grants | Cloudflare Worker                                          |
| Temporary source      | private R2 Standard bucket, immediate application deletion |
| Derived artifacts     | separate private R2 Standard bucket                        |
| Job notification      | Cloudflare Queue with dead-letter handling                 |
| Parser                | bounded Cloudflare Container pool, Node 24 plus Rust addon |
| Metadata and leases   | Turso database                                             |
| Public access         | no visitor login; bounded routes and upload abuse controls |
| Reference/recovery    | local SQLite and filesystem Compose deployment             |

## Manual account-owner checklist

Complete these actions once the implementation supplies the exact names and
least-privilege requirements. Do not paste credentials into an issue, chat,
shell history or tracked environment file.

### Domain and public access

- [ ] Add the registered domain to Cloudflare and complete the registrar DNS
      delegation if it is not already using Cloudflare nameservers.
- [ ] Choose the production and staging hostnames, for example `app.example.com`
      and `staging.example.com`.
- [ ] Define upload rate limits and a cost ceiling before enabling public
      ingestion.
- [ ] Confirm that Cloudflare-selected Container placement is acceptable. This
      architecture does not promise Los Angeles placement or US-only residency.

### Cloudflare account

- [ ] Enable Workers Paid and add a payment method.
- [ ] Set billing notifications and an account-level spend policy. Begin with a
      conservative concurrency ceiling; a budget is not a substitute for an
      application-side ceiling.
- [ ] Authorize separate staging and production Pages projects, Worker services,
      R2 source buckets, R2 artifact buckets, Queues, dead-letter Queues and
      Container namespaces.
- [ ] Create a deployment token scoped only to the required account resources,
      or complete an interactive Wrangler login on the deployment runner.
- [ ] Create one private R2 bucket dedicated to Terraform state and an R2 access
      key limited to that bucket. This is the only bootstrap bucket; never place
      application data in it.
- [ ] Create bucket-scoped credentials only if the chosen direct-upload design
      requires S3-compatible signing. Prefer Worker R2 bindings wherever possible.
- [ ] Configure Cloudflare upload rate limits and automated health checks.

### Turso account

- [ ] Create the Turso organization and separate staging and production
      databases.
- [ ] Create database-scoped application and migration credentials with the
      narrowest supported privileges and independent staging/production values.
- [ ] Configure usage alerts and decide whether exceeding a plan limit should
      fail closed or permit paid overage.
- [ ] Record the provider's backup/recovery options and perform a staging restore
      exercise before production ingestion.

### Product and retention decisions

- [ ] Set the maximum demo size, maximum files per submission and per-identity
      upload rate. Do not exceed the parser's 512 MiB hard input cap.
- [ ] Confirm immediate raw-demo deletion after verified extraction and for
      failed/cancelled jobs, with a 24-hour R2 lifecycle backstop for orphans.
- [ ] Set detailed telemetry retention. The initial proposal is 90 days, with a
      separately authorized hold for selected review cases.
- [ ] Decide how long compact reports, provenance and audit tombstones remain.
- [ ] Approve an initial monthly cost ceiling only after the staged 1,000-demo
      benchmark; revisit it after the 10,000-demo test.

## Secrets inventory

Store secrets in Cloudflare secrets or the relevant provider secret store, and
keep an offline recovery record where loss would be destructive.

| Secret                         | Consumer                               | Rotation consequence                                              |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------- |
| Turso database URL/token       | Worker and networking container parent | rotate per environment; revoke old token after rollout            |
| `L4DSTATS_PSEUDONYM_KEY`       | parser child through a minimal handoff | loss prevents new demos joining historical cases                  |
| session/API signing secrets    | Worker                                 | active sessions or internal calls are invalidated                 |
| R2 signing credential, if used | upload-grant Worker only               | outstanding signed grants remain bearer capabilities until expiry |
| Cloudflare deployment token    | CI only                                | deployment stops; runtime should remain unaffected                |

Never expose Turso, R2, deployment or pseudonym credentials to browser bundles.
Do not send general API secrets into the parser child. Secret rotation
must be tested in staging and audited without logging values.

## Environment isolation and naming

Production and staging must not share databases, buckets, Queues, dead-letter
Queues, Container identities, hostnames or secrets. Use an explicit prefix and
environment tag rather than relying on the active CLI account.

Suggested logical layout (final names are implementation-owned):

```text
staging
  Worker/Pages
  source R2 bucket: temporary/uploads/<job-id>
  artifact R2 bucket: sha256/<first-two-hex>/<sha256>
  Queue + dead-letter Queue
  Container namespace
  Turso database

production
  the same resources, independently bound
```

The source bucket uses R2 Standard because temporary objects are deleted quickly
and Standard has no minimum storage duration. Keep both buckets private. Permit
browser CORS only from the exact environment origin. A direct upload grant must:

- authorize `PUT` for one unpredictable object key;
- use a short expiry;
- bind the expected content type and any enforceable checksum/size metadata;
- never grant list or arbitrary read access; and
- be treated as a bearer secret in logs and telemetry.

Set a lifecycle deletion rule on the temporary prefix for the 24-hour orphan
backstop. R2 lifecycle processing can occur after the nominal expiry, so alerts
and the normal application delete path remain required.

## Infrastructure as code and continuous deployment

Terraform under `infra/terraform/cloudflare` is authoritative for the two
private application buckets, the abandoned-upload lifecycle rule and the
analysis/dead-letter Queues. Terraform state uses the separately bootstrapped
private R2 state bucket. Wrangler remains authoritative for the versioned Worker
bundle, static assets, bindings and Container image.

Pushes to `main` run `.github/workflows/deploy-production.yml`: the complete
quality gate runs first, Terraform plans and applies through the protected
`production` GitHub environment, then Wrangler publishes secrets and deploys
the verified commit. Configure these GitHub production environment values:

The Worker also keeps its `workers.dev` hostname enabled. This provides a
temporary deployment URL while custom-domain DNS is propagating and remains a
useful direct health-check target afterward.

- variable `PRODUCTION_HOSTNAME`;
- secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`;
- secrets `TF_STATE_R2_BUCKET`, `TF_STATE_R2_ACCESS_KEY_ID` and
  `TF_STATE_R2_SECRET_ACCESS_KEY`;
- secrets `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and
  `L4DSTATS_PSEUDONYM_KEY`.

Protect the GitHub environment and `main` branch. Terraform plans must never be
generated from untrusted pull-request code with production credentials.

## Migration and deployment sequence

### Staging

1. Verify the full local quality gate and the hosted adapter tests.
2. Apply Turso migrations with a dedicated migration identity. Record migration
   ID and schema hash; never run an unreviewed destructive migration at startup.
3. Apply private bucket CORS and lifecycle configuration and read it back for
   verification.
4. Create Queue and dead-letter bindings and deploy the Container image with its
   provenance-stamped Rust addon.
5. Deploy the API Worker and static assets with public ingestion disabled.
6. Bind the staging hostname and configure upload rate limits.
7. Run a health check, then enable uploads for a limited staging cohort.
8. Process a non-sensitive known-good demo and verify the complete lifecycle:

   ```text
   browser PUT -> source object -> job metadata -> Queue -> lease -> Container
   -> source SHA-256 -> derived R2 hashes -> Turso commit -> source deletion
   -> report deep link
   ```

9. Confirm the source R2 key and container temporary copy no longer exist before
   the report is shown as successful.
10. Confirm the report states that the source was deleted and reanalysis asks
    for a matching re-upload.

### Production

1. Create fresh production resources; do not copy staging credentials or data.
2. Apply the same reviewed schema, bucket, Queue and deployment revisions used
   in staging.
3. Keep public ingestion disabled and run readiness checks.
4. Permit a small operator cohort, then increase traffic gradually only while
   queue age, retry rate, deletion lag, database use and projected spend remain
   inside limits.
5. Preserve the previous Worker and Container revision for a bounded rollback.
   Database migrations must remain backward compatible for that rollback window.

## Acceptance and failure tests

Before production ingestion, staging must demonstrate:

- valid, corrupt, truncated, oversized and timed-out demo handling;
- duplicate Queue delivery with one accepted immutable result;
- container termination before and after each durable write;
- expired lease recovery and attempt exhaustion;
- R2 write succeeds but Turso commit fails;
- Turso artifact commit succeeds but source delete initially fails;
- interrupted direct upload and abandoned multipart cleanup;
- cancellation during download and parsing;
- native addon lineage mismatch and missing addon failure;
- unavailable/purged telemetry displayed as unavailable, never zero;
- matching and non-matching source re-upload behavior; and
- mutation quota, upload rate-limit and signed-upload expiry enforcement.

Run the repository definition-of-done gate plus the hosted integration,
recovery and load suites:

```bash
pnpm format:check
pnpm check
pnpm test
pnpm build
```

The implementation must add concrete hosted commands before this runbook is
marked operational. Never substitute production demos for committed fixtures;
benchmark manifests contain hashes and aggregate measurements only.

## Capacity qualification

Use increasingly large, authorized external corpora: a smoke set, 100-demo soak,
1,000-demo benchmark and 10,000-demo pre-production run. Record at minimum:

- parser wall time, CPU time and peak memory per demo;
- Container cold-start and active/idle duration;
- input and derived bytes per demo, split by artifact kind;
- R2 Class A/B operations and retained GB-month projection;
- Turso bytes, rows read and rows written per demo;
- Queue delay, retry and duplicate-delivery counts;
- source deletion latency and oldest remaining temporary source; and
- parser/config/wire/build and map-asset lineage.

Project 100,000 demos/month from percentiles, not only the mean. Set maximum
concurrency from the observed p95 memory and cost. Stop rollout if the parser
runtime, derived telemetry retention or database writes make the approved cost
ceiling implausible; benchmark an explicitly placed compute alternative rather
than hiding cost with weaker safety limits.

## Monitoring and alerts

Do not emit filenames, signed URLs, player identities, source bytes or secrets in
logs, metrics or traces. Job IDs and hashes should be exposed only to authorized
operators where needed for recovery.

Initial alert conditions:

| Signal                                  | Warning                | Critical/action                                           |
| --------------------------------------- | ---------------------- | --------------------------------------------------------- |
| Oldest queued job                       | 5 minutes              | 15 minutes; pause new ingestion                           |
| Successful analysis with source present | 15 minutes             | 1 hour; pause success publication and investigate cleanup |
| Oldest temporary source                 | 2 hours                | 24 hours; pause ingestion and verify lifecycle policy     |
| Parse failures                          | 3 in 15 minutes        | 10 in 15 minutes or repeated same build/stage             |
| Lease expiry                            | any sustained increase | repeated expiry for same job/build                        |
| Provider use                            | 70% of plan/budget     | 85% throttle; 95% pause ingestion                         |
| Dead-letter Queue                       | first message          | sustained growth; keep payload unavailable to users       |
| Metadata or artifact verification       | first mismatch         | immediate ingestion stop and integrity incident           |

Also monitor p50/p95/p99 parse time, cold starts, active containers, Queue
delivery attempts, Turso latency/error/write count, R2 operation count and bytes
by retention class, authentication failures and projected month-end spend.

## Incident response

1. Disable new upload grants and Queue dispatch without deleting queued metadata.
2. Record UTC time, deployed Worker/Container revision, migration ID and affected
   job/content hashes. Capture bounded logs after privacy review.
3. Classify the incident as authentication, source cleanup, Queue/lease,
   parser, metadata, artifact integrity, capacity/cost or provider outage.
4. For parser suspicion, stop dispatch and preserve hashes and complete lineage;
   never retain or redistribute the source merely for convenience.
5. For cleanup failure, retry the exact idempotent object deletion and verify the
   lifecycle rule. Do not mark affected jobs successful until deletion is
   confirmed.
6. For artifact mismatch, make the report unavailable, preserve both recorded
   hashes, and require a new derivation version rather than rewriting history.
7. Rotate possibly exposed credentials. Preserve the old pseudonym key securely
   when correlation continuity is needed; changing it prevents future joins.
8. Recover Turso and R2 only through provider-tested procedures and verify every
   restored artifact hash/reference before reopening ingestion.
9. Resume with operator-only traffic, then repeat the staged ramp.

Never convert a review-priority signal into automated enforcement or describe a
player as a cheater during an incident or after recovery.

## Rollback

Worker/Pages rollback may select the last known-good immutable revision. A
Container rollback must also restore its matching parser/config/wire/build
lineage. Do not deploy an old binary against a newly incompatible database
schema. Queue messages remain idempotent across the supported rollback window,
and an old worker must reject unknown contract versions explicitly.

Rolling back code does not restore deleted raw demos. Reports already committed
under a withdrawn derivation remain immutable but can be marked unavailable or
superseded. Reanalysis requires the user to re-upload bytes matching the stored
source SHA-256.

## Current provider references

- [Cloudflare Containers lifecycle](https://developers.cloudflare.com/containers/platform-details/architecture/)
- [Cloudflare Container limits and instance types](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Cloudflare Workers and Containers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 lifecycle behavior](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Turso documentation](https://docs.turso.tech/)

Provider behavior and pricing are temporally unstable. Recheck these primary
references during implementation and before approving a production budget.
