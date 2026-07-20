<div align="center">

# L4DStats

### Drop demos. Get the whole match.

A local-first Left 4 Dead 2 demo review workbench for match statistics,
tactical reconstruction, and explainable review signals.

[Try L4DStats](https://l4dstats.gg) · [Quick start](#quick-start) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md)

</div>

![L4DStats match overview](docs/assets/l4dstats-overview.jpg)

L4DStats turns SourceTV `.dem` files into a browsable account of a Versus
match. It reconstructs rounds and players, calculates descriptive statistics,
plots tick-addressed events, and surfaces unusual moments for human review.

It is designed to preserve uncertainty. Missing telemetry stays missing,
provenance travels with derived results, and every review signal includes its
explanation, limitations, and strongest available counterevidence.

> [!IMPORTANT]
> L4DStats does not determine whether a player cheated. Its output is
> descriptive and must not be used for automated enforcement or as the sole
> basis for punitive action.

## Highlights

- Upload one to ten demos and follow each analysis job live.
- Group map demos into complete games using embedded continuity, roster,
  campaign, and chapter evidence—not filenames alone.
- Explore Survivor and Infected scoreboards, weapons, SI classes, pins,
  incaps, revives, deaths, checkpoints, Tank and Witch outcomes, and campaign
  scoring.
- Scrub a filterable event story using ticks as the canonical coordinate.
- Inspect movement and view-angle coverage, parser quality, reconstruction
  availability, and provenance alongside the statistics.
- Review prerequisite-gated detector windows with tick deep links,
  explanations, limitations, counterevidence, and quality metadata.
- Visualize player paths against provenance-stamped analytical geometry for
  all 57 official campaign maps.
- Reanalyze retained artifacts with the current engine without pretending old
  and new parser versions are equivalent.

## Quick start

The complete local stack requires Docker Desktop (or Docker Engine with Compose):

```bash
git clone https://github.com/banja-au/l4dstats.git
cd l4dstats
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173) and drop in up to ten
`.dem` files. The API, worker, SQLite database, upload storage, native parser,
and web app run in Compose; application data and dependencies remain in named
volumes.

Stop the stack with `Ctrl+C`, then remove its containers with:

```bash
pnpm dev:docker:down
```

To expose the workbench beyond localhost, set credentials and replace the
development API secret first:

```bash
export L4DSTATS_WEB_USERNAME=l4dstats
export L4DSTATS_WEB_PASSWORD='use-a-long-random-password'
export L4DSTATS_API_TOKEN="$(openssl rand -hex 32)"
pnpm dev:docker
```

Use that access gate only behind TLS or a trusted private network. See the
[local operations guide](docs/operations/local-workbench.md) for role-based
credentials, backup, restore, retention, and production Compose guidance.

### Native development

Native development requires Node.js 24+, Corepack, and the Rust toolchain
pinned by `rust-toolchain.toml`:

```bash
./init.sh
pnpm build
pnpm dev
```

`pnpm dev` starts the web surface. Use `pnpm dev:docker` for the complete
upload-to-analysis pipeline. The repository-built Node-API addon is mandatory:
if it is missing, stale, or incompatible, analysis fails explicitly rather
than falling back to a different parser.

## How it works

```text
browser uploads
      │ streamed, bounded, SHA-256 hashed
      ▼
API ──► durable SQLite queue ──► worker
                                      │
                clean-room Rust decode + L4D2 projection
                                      │
                statistics + explainable review signals
                                      │
      browser ◄── versioned analysis artifact
```

The decoder is clean-room Rust exposed through one coarse, bytes-only Node-API
boundary. TypeScript owns strict contract adaptation, statistics, detectors,
storage, and presentation. Parser execution is isolated from network access;
uploaded archives pass through bounded, fail-closed expansion checks before
decoding.

The monorepo is organized around narrow interfaces:

```text
apps/web/                 React/Vite review experience
apps/api/                 streaming uploads and job state
apps/worker/              isolated, retryable analysis jobs
apps/cli/                 deterministic demo and corpus inspection
apps/edge/                hosted Cloudflare boundary
packages/contracts/       versioned observation and evidence contracts
packages/detectors/       explainable review-signal detectors
packages/l4d2-rating/     shared rating methodology implementation
packages/storage/         SQLite/Turso metadata and artifact indexes
packages/map-source1/     bounded analytical map-geometry extraction
crates/demo-source1-native/ clean-room Source 1 decoder and L4D2 projection
crates/demo-source1-node/ bytes-only Node-API binding
```

Read the [architecture guide](docs/ARCHITECTURE.md) and
[threat model](docs/THREAT_MODEL.md) for the full trust boundaries.

## Supported inputs and evidence boundaries

The browser accepts raw `.dem` files. Hosted ingestion also supports a single
demo in `.zip`, `.dem.gz`, `.dem.xz`, `.dem.bz2`, or `.dem.zst`, subject to
suffix/magic agreement, member and path checks, compressed and expanded byte
caps, ratio limits, timeouts, hashing, and idempotent job handling.

Demo telemetry is not ground truth. SourceTV perspective, packet loss, parser
coverage, pauses, skips, map assets, and game context all limit what can be
concluded. L4DStats therefore:

- uses ticks as the primary timeline and stores derived demo time separately;
- identifies a player by stable Steam identity plus a demo-local connection
  epoch, never a slot or user ID alone;
- records parser, detector, model, configuration, map-asset, and derivation
  lineage;
- renders unavailable values as unavailable, never as zero; and
- reports review priority or insufficient data—not a verdict about conduct.

The exact extracted, derived, and unavailable fields are documented in
[DEMO-DATA.md](DEMO-DATA.md). See [RESEARCH.md](docs/RESEARCH.md) for the
scientific limits and [DETECTORS.md](docs/DETECTORS.md) for signal semantics.

## Verification

Install dependencies with `./init.sh`, then run the repository gates:

```bash
pnpm format:check
pnpm check
pnpm test
pnpm build
```

Additional boundaries have focused gates:

```bash
pnpm test:e2e          # browser tests; real-corpus cases require ignored fixtures
pnpm test:production   # production Compose model, probes, stack, and sandbox
pnpm test:recovery     # backup/restore and archive-safety recovery checks
pnpm test:sandbox      # parser process isolation
pnpm security:check    # JS and Rust dependency/license policy
```

Real demos, archives, player identifiers, databases, clips, and source game
assets are intentionally excluded from the repository. Tests that need a real
corpus validate ignored local fixtures by hash.

## Documentation

- [L4D2 and Versus domain model](L4D2.md)
- [Demo data and availability contract](DEMO-DATA.md)
- [Rating methodology](docs/L4DSTATS-RATING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Detector behavior](docs/DETECTORS.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Third-party and licensing notes](docs/THIRD_PARTY.md)
- [Architecture decision records](docs/decisions/)

## Contributing and security

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), keep
changes focused, add tests at the cheapest useful layer, and preserve the
project's evidence and privacy boundaries.

L4DStats processes untrusted binary files and potentially sensitive behavioral
telemetry. Please read [SECURITY.md](SECURITY.md) before reporting a
vulnerability, and never include private demos or real player data in an issue.
