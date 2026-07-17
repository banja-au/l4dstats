# Local workbench operations

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

## Ingest

Files beneath `data/sprint-1-corpus/extracted` are visible read-only inside the
containers at `/data/inbox`. Enter the corresponding absolute container path in the
ingest dialog. Local files must resolve beneath that root, use the `.dem` extension,
be regular files below the configured byte limit, and are SHA-256 hashed before the
job is queued.

Remote input accepts HTTPS URLs from `WITCHWATCH_ALLOWED_HOSTS` (default:
`cedapug.com`). The worker streams the allowlisted response through the guarded
downloader with redirect, timeout, and two-GiB compressed-input limits. A `.dem` is
stored directly; an archive must pass entry, expansion, per-entry, traversal, and
compression-ratio limits and contain exactly one `.dem`. Source and extracted demo
hashes are persisted in derivation lineage before analysis.

The local worker invokes the versioned CLI without a shell. It caps execution at
five minutes and combined captured stdout/stderr at 16 MiB. Jobs remain durable and
may be cancelled or retried.

## Runtime data and recovery

- Health: `http://localhost:8787/health`
- OpenAPI: `http://localhost:8787/api/openapi.json`
- API logs: `docker compose logs -f api`
- Worker logs: `docker compose logs -f worker`
- Web logs: `docker compose logs -f web`

Runtime configuration:

- `WITCHWATCH_DB` selects the SQLite metadata database.
- `WITCHWATCH_ARTIFACT_ROOT` selects content-addressed source and result storage.
- `WITCHWATCH_LOCAL_ROOTS` is a comma-separated local ingest allowlist.
- `WITCHWATCH_ALLOWED_HOSTS` is a comma-separated remote HTTPS allowlist.
- `WITCHWATCH_PSEUDONYM_KEY` keys the HMAC used to associate the same stable
  identity across independently ingested demos without retaining the raw identity.
- `WITCHWATCH_STALE_JOB_MS` and `WITCHWATCH_MAX_JOB_ATTEMPTS` control abandoned
  lease recovery.

The bundled pseudonym key is development-only. Set a long random
`WITCHWATCH_PSEUDONYM_KEY` before reviewing non-fixture demos, keep it out of Git,
and retain it securely for the lifetime of the database. Rotating or losing the key
intentionally prevents new demos from joining older cases. Tokens produced with
different keys, and demo-local epochs where stable identity was unavailable, never
corroborate one another. Case reports preserve each contributing demo/result hash,
version/config/map lineage, and the privacy-token association explanation; they do
not contain the raw platform identity.

If a worker stops, queued/running metadata remains in SQLite. On API restart, a
running lease older than five minutes is requeued; after three expired attempts it
is failed instead of looping forever. Failed or cancelled work can be retried from
the ingest dialog. Reports are canonical JSON; the UI recomputes SHA-256 before
download and includes the digest in the filename.

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

- complete production output: 520 KiB;
- JavaScript: 250 KiB;
- CSS: 45 KiB;
- original hero illustration: 230 KiB;
- HTML: 8 KiB.

Run the check again against an existing build with `pnpm --filter
@witchwatch/web test:budget`. Raw bytes are deliberately enforced rather than
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
