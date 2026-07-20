# Contributing to L4DStats

Thanks for helping improve L4DStats. Contributions should make demo review more
reproducible, understandable, or safe. Please keep claims proportional to the
available telemetry: the project prioritizes human review and never labels a
player a cheater or automates enforcement.

## Before you start

- Search existing issues before opening a new one.
- Use an issue to discuss substantial behavior, contract, architecture, or data
  methodology changes before investing in an implementation.
- Read [L4D2.md](L4D2.md) for the shared Versus domain model and
  [DEMO-DATA.md](DEMO-DATA.md) before changing parsing or statistics.
- Read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

Never attach real demos, archives, player identifiers, databases, game assets,
clips, credentials, or private telemetry to an issue or pull request. Use a
minimal synthetic fixture. Bounded derived geometry may only be contributed
under the provenance and catalog policy in
[ADR 0007](docs/decisions/0007-local-map-geometry-assets.md).

## Development

The easiest complete development environment uses Docker Desktop:

```bash
docker compose up --build
```

For native development, install Node.js 24+, Corepack, and the pinned Rust
toolchain, then run:

```bash
./init.sh
pnpm build
```

Keep changes focused. Prefer pure functions and narrow interfaces, preserve
unknown telemetry as unknown, and add tests at the cheapest useful layer.
Parser changes need synthetic golden and corrupt fixtures; detector changes
need benign and anomalous cases. Meaningful architectural decisions belong in
`docs/decisions/`.

## Pull requests

Use a conventional commit subject such as `feat:`, `fix:`, `docs:`, `test:`, or
`refactor:`. Before requesting review, run:

```bash
pnpm format:check
pnpm check
pnpm test
pnpm build
```

Describe the evidence for the change, its limitations and unresolved risks.
If a check cannot run locally, say which check and why. Parsing or statistics
changes must update `DEMO-DATA.md`; rating changes must keep the methodology,
`packages/l4d2-rating`, and adapters synchronized.

By contributing, you agree that your contribution is submitted under the
repository's current licensing terms. No software license has been selected,
so opening the source does not grant general redistribution rights.
