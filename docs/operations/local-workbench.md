# Local workbench operations

For production health thresholds, incident triage and recovery verification,
see [the production response runbook](production-response.md).

## Start and stop

Docker Desktop is the only host requirement:

```bash
pnpm dev:docker
# open http://localhost:5173
pnpm dev:docker:down
```

Compose starts `web`, `api`, and `worker`. The browser talks only to Vite; `/api`
and `/health` are proxied to the API container. SQLite lives in the named
`workbench-data` volume. Removing containers preserves it; `docker compose down -v`
also removes that local database and is intentionally not part of the normal stop
command.

For a private production-shaped deployment, set the web credentials and API
token documented below, then run `pnpm prod:docker`. The production overlay
builds the API, worker and web application, runs their compiled output, and
serves the SPA through the bounded Node static/proxy server instead of Vite
development middleware. The server applies CSP, frame, MIME-sniffing, referrer
and permissions headers and refuses to start when authentication is incomplete.

## Ingest

Files beneath `data/sprint-1-corpus/extracted` are visible read-only inside the
containers at `/data/inbox`. Enter the corresponding absolute container path in the
ingest dialog. Local files must resolve beneath that root, use the `.dem` extension,
be regular files below the configured byte limit, and are SHA-256 hashed before the
job is queued.

Remote input accepts HTTPS URLs from `L4DSTATS_ALLOWED_HOSTS` (default:
`cedapug.com`). The worker streams the allowlisted response through the guarded
downloader with redirect, timeout, and two-GiB compressed-input limits. A `.dem` is
stored directly; an archive must pass entry, expansion, per-entry, traversal, and
compression-ratio limits and contain exactly one `.dem`. Source and extracted demo
hashes are persisted in derivation lineage before analysis.

The local worker invokes the versioned CLI without a shell. It caps execution at
five minutes and combined captured stdout/stderr at 16 MiB. Jobs remain durable and
may be cancelled or retried.

Evidence analysis requires the Rust addon at
`crates/demo-source1-node/dist/demo-source1-node.node`. Production builds and
stamps it automatically. The development Compose worker runs
`pnpm native:prepare` before it starts; the local CLI and web development scripts
use the same prerequisite. An addon-load failure stops analysis; no fallback
parser exists.

## Runtime data and recovery

- Health: `http://localhost:8787/health`
- OpenAPI: `http://localhost:8787/api/openapi.json`
- API logs: `docker compose logs -f api`
- Worker logs: `docker compose logs -f worker`
- Web logs: `docker compose logs -f web`

Runtime configuration:

- `L4DSTATS_DB` selects the SQLite metadata database.
- `L4DSTATS_ARTIFACT_ROOT` selects content-addressed source and result storage.
- `L4DSTATS_LOCAL_ROOTS` is a comma-separated local ingest allowlist.
- `L4DSTATS_ALLOWED_HOSTS` is a comma-separated remote HTTPS allowlist.
- `L4DSTATS_PSEUDONYM_KEY` keys the HMAC used to associate the same stable
  identity across independently ingested demos without using a mutable player
  name as a join key. Local analysis artifacts also retain the demo's display
  name and SteamID64 so the statistics UI can identify players and link profiles.
- `L4DSTATS_STALE_JOB_MS` and `L4DSTATS_MAX_JOB_ATTEMPTS` control abandoned
  lease recovery.
- `L4DSTATS_MUTATION_RATE_LIMIT` and
  `L4DSTATS_MUTATION_RATE_WINDOW_MS` bound non-read API requests per direct
  client address, or per verified web identity when the authenticated proxy
  supplies one. The local default is 120 mutations per minute. Identity headers
  are ignored for quota selection unless the request also carries the valid
  internal bearer token.
- `L4DSTATS_API_TOKEN` enables bearer authentication for every `/api` route.
  It must contain at least 32 bytes. The Vite proxy injects it server-side, so
  normal browser requests do not expose it in shipped JavaScript or browser
  storage. `/health` stays unauthenticated for container health checks. The
  Compose default is development-only; set a random secret before sharing the
  service. This protects the API boundary but does not authenticate a browser
  user because the trusted web proxy injects the bearer token.
- `L4DSTATS_AUTH_FAILURE_LIMIT` and
  `L4DSTATS_AUTH_FAILURE_WINDOW_MS` bound invalid bearer attempts per direct
  client address. Successful authentication clears that client's failure
  bucket. The default is 20 failures per five minutes.
- Parser subprocesses use a direct shell-free Node invocation with bounded
  memory, CPU, file descriptors, output, elapsed time and TERM-to-KILL cleanup.
  Production analysis uses compiled CLI output and fails closed on Linux if its
  seccomp launcher is absent. The launcher denies network-related syscalls and
  ptrace/BPF/io_uring; Node permissions allow reads only from application code
  and the single demo while denying writes, subprocesses and workers. Native
  addon permission is enabled only for that parser child. Because Node cannot
  restrict syscalls made by the addon, its bytes-only API remains behind
  seccomp, rlimits, the read-only container and process-group cleanup.
  API and web credentials are removed from the child environment. Run
  `pnpm test:sandbox` to process a real demo through the compiled boundary.

The parser configuration caps input at 512 MiB, compact output at 256 MiB,
observations at 2,000,000, identity mappings at 16,384, match states at 100,000,
raw events at 2,000,000, required events at 1,000,000 and event kinds at 4,096.
The pseudonym key must contain 16–64 bytes. The child additionally has a 4 GiB
V8 heap, 5 GiB address-space, 300-second CPU, 64-file and 16 MiB captured-output
limits. Cancellation sends TERM to the process group and KILL after one second;
the native task itself is not cooperatively cancelled.

- `L4DSTATS_WEB_USERNAME` and `L4DSTATS_WEB_PASSWORD` enable a single-user
  HTTP Basic gate in front of the complete web surface. They must be set
  together and the password must contain at least 16 bytes. Use this only over
  a trusted encrypted tunnel or TLS because Basic credentials are not encrypted
  by HTTP itself. It is suitable for a private local/Twingate workbench, not a
  substitute for multi-user identities, RBAC or an external identity proxy.
  Both development and production web gates bound failures to 20 attempts per
  client address over five minutes; a valid login clears the bucket.
- `L4DSTATS_WEB_USERS_JSON` replaces the two single-user variables for a
  small team deployment. It is a JSON array of unique objects with `username`,
  a password of at least 16 bytes, and role `viewer`, `reviewer`, or `admin`.
  Viewers can open reports and use read-only API routes but cannot submit API
  mutations. Reviewers and admins can mutate the current workbench API. The web
  proxy strips caller-supplied identity and role headers, injects the verified
  values beside its private bearer token, and the API gives each identity an
  independent mutation quota. Keep the JSON in a secret manager or protected
  environment file, never in Compose source or shell history. For internet
  exposure, terminate TLS and prefer a mature external identity provider.

The bundled pseudonym key is development-only. Set a long random
`L4DSTATS_PSEUDONYM_KEY` before reviewing non-fixture demos, keep it out of Git,
and retain it securely for the lifetime of the database. Rotating or losing the key
intentionally prevents new demos from joining older cases. Tokens produced with
different keys, and demo-local epochs where stable identity was unavailable, never
corroborate one another. Case reports preserve each contributing demo/result hash,
version/config/map lineage, and the privacy-token association explanation. Case
reports do not contain the raw platform identity; access to local analysis
artifacts must be treated as access to player identity.

If a worker stops, queued/running metadata remains in SQLite. On API restart, a
running lease older than five minutes is requeued; after three expired attempts it
is failed instead of looping forever. Failed or cancelled work can be retried from
the ingest dialog. Reports are canonical JSON; the UI recomputes SHA-256 before
download and includes the digest in the filename.

### Backup and restore

Backups include the SQLite database, uploads, content-addressed analysis
artifacts and extracted geometry in the `workbench-data` volume. The script
briefly stops the API and worker for a consistent offline snapshot, preserves
their prior running state, and writes a SHA-256 sidecar:

```bash
pnpm backup:docker
# or choose an ignored destination
pnpm backup:docker -- /path/to/backups
```

Restore is intentionally explicit and requires the matching checksum file. It
verifies the checksum and archive member paths before replacing the volume. If
extraction fails, the in-container pre-restore snapshot is put back before the
services restart:

```bash
pnpm restore:docker -- backups/l4dstats-workbench-YYYYMMDDTHHMMSSZ.tar.gz --confirm-restore
```

Run a restore drill before relying on a backup: record a known game URL, create
a backup, ingest or remove disposable state, restore, then confirm the URL and
analysis hashes are unchanged. Copy backups away from the Docker host and apply
the same access controls as the live volume because analysis artifacts contain
player identities.

The automated recovery gate exercises the same database-plus-artifact recovery
boundary without requiring a Docker daemon. It creates a migrated SQLite
workbench and content artifact, archives them, verifies the archive checksum and
member safety, restores into a clean root, compares both hashes, reopens the
database through the production storage package, and proves a corrupted archive
is rejected:

```bash
pnpm test:recovery
```

### Retention and deletion

Preview terminal jobs older than a chosen age without changing state:

```bash
pnpm retention:docker -- 30
```

Purge requires an explicit confirmation. The wrapper stops the API and worker,
preserves their prior running state, stages eligible files by atomic rename,
deletes metadata transactionally, then removes the staged files. A failure
before the database commit restores staged files. Active jobs, shared demo
objects, shared upload paths and cases backed by a retained copy survive.
Audit tombstones record counts and the cutoff without retaining deleted player
identities.

```bash
pnpm retention:docker -- 30 --confirm-purge
```

Only uploaded files beneath `L4DSTATS_UPLOAD_ROOT` are eligible for source
deletion. Files from the read-only inbox are never removed. Unreferenced
content-addressed demo and result objects are deleted from
`L4DSTATS_ARTIFACT_ROOT`. Take and verify a backup before the first purge.

## Browser verification

```bash
pnpm test:e2e
```

Playwright starts an in-memory seeded API and the Vite app, then checks desktop
1440×1000 and mobile 390×844 journeys. Screenshots, traces, and videos remain ignored
under `apps/web/test-results` and `apps/web/playwright-report`.

## Performance budgets

Every production web build runs `apps/web/scripts/check-asset-budget.mjs` and fails
if the emitted first-load files exceed any raw-byte ceiling:

- complete production output: 740 KiB;
- JavaScript: 314 KiB;
- CSS: 76 KiB;
- original hero illustration: 230 KiB;
- background illustration: 150 KiB;
- brand images: 75 KiB;
- HTML: 8 KiB.

Run the check again against an existing build with `pnpm --filter
@l4dstats/web test:budget`. Raw bytes are deliberately enforced rather than
trusting compression estimates, while Vite also reports gzip sizes during builds.

The Sprint 4 workbench is one cohesive screen rather than a set of independent
routes, so route-level lazy loading would currently add a request waterfall without
removing an optional workflow. Case results are server-paginated with a hard maximum
of 100 rows and telemetry responses are capped at 16 clipped chunks. At those bounds
DOM virtualization adds complexity without a measurable need. Reconsider route
splitting when a genuinely independent settings/report route exists, and
virtualization only if profiling shows bounded pages missing the interaction budget.

## Safety boundary

The seeded case is invented and explicitly research-only. Review status and notes
are audit records, not enforcement actions. The API has no ban, sanction,
publication, or accusation endpoint. Browser telemetry endpoints accept at most
3,000 ticks and never return an entire observation artifact.
