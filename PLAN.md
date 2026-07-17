# Delivery plan

Five sprints take the project from protocol proof to a defensible, deployable review workbench. Each sprint is designed as one long-running lead workflow with parallel research/implementation/verification tracks. A sprint closes only when its exit gate is demonstrated; elapsed time is secondary.

## Shared execution protocol

At sprint start, the lead freezes the relevant versioned contracts and assigns non-overlapping tracks. Agents return source links, assumptions, files changed, commands/results, and risks. The lead integrates one vertical slice, runs the full quality gate, records benchmarks/evaluation artifacts, updates ADRs, and produces a short sprint report. Contract ownership is never delegated to multiple agents.

Every sprint runs unit, contract, integration, corruption/adversarial, and end-to-end tests in proportion to its scope. Synthetic or consented data is committed only when redistribution is clearly permitted; otherwise fixtures remain hash-addressed external test data with expected manifests.

---

## Sprint 1 — Prove the telemetry

**Outcome:** deterministically turn heterogeneous CEDAPug archives into validated player/tick observations, or make a documented parser pivot.

### Parallel tracks

- **Corpus and acquisition:** implement streamed directory discovery, bounded downloads, safe ZIP extraction, SHA-256 manifests, cache/resume, and select ten fixtures spanning years, maps, protocols, POV/SourceTV types, and custom servers.
- **Decoder:** spike the pinned `demofile` low-level core; parse header, command frames, net messages, send/string tables, events, and entities; capture unknowns without failing closed.
- **L4D2 projection:** map player epochs/Steam IDs, teams/classes, positions, eye angles, weapons, shots, damage, death, round state, cvars, tick and demo time. Track availability per field.
- **Validation:** compare selected ticks to compatible in-game playback/reference tooling; build truncated/corrupt/property/fuzz cases and a protocol coverage report.

### Deliverables

`apps/cli`, `packages/acquisition`, `packages/demo-source1`, `packages/l4d2-schema`, contract v1, golden manifest runner, protocol coverage report, parser benchmark, licensing inventory, and ADR confirming or replacing the decoder.

### Exit gate

All ten demos recover stable player epochs, core events, positions, eye angles, and weapon/fire events with explicit availability; reruns are byte-deterministic; malformed inputs stay within limits; unknown protocol content is reported. If view angles/user commands are unavailable for a demo type, document the scope limit. Independent parser and licensed-playback comparisons are required before release or empirical accuracy claims, but do not block calibration implementation once the real-corpus telemetry and reproducibility gates pass.

---

## Sprint 2 — Build an evidence engine

**Outcome:** emit explainable, independently testable evidence windows without claiming a probability.

### Parallel tracks

- **Geometry/context:** map coordinate transforms, BSP/overview spike, static/dynamic LOS, visibility quality, prior sightings, audibility proxies, pauses/lerp/latency, and survivor/infected/weapon state.
- **Aim detectors:** angular error, speed/acceleration/jerk, snap/correction shape, acquisition/target-switch latency, tracking error, quantization, and shot timing, normalized by encounter context.
- **Awareness/invariant detectors:** hidden-target alignment and pre-aim with information audits; cadence/ammo/state and movement invariants only when prerequisites are authoritative.
- **Test science:** pure detector fixtures, geometry truth tables, clean elite-play hard negatives, instrumented/synthetic anomalies, missing-tick and adversarial-humanization tests.

### Deliverables

`packages/geometry`, `packages/detectors`, encounter segmentation, evidence schema v1, detector registry/versioning, feature explorer CLI, detector cards documenting prerequisites/failure modes, and benchmark suite.

### Exit gate

Every detector produces tick range, raw features, effect size/contribution placeholder, quality, explanation, limitations, and counterevidence. No detector consumes unavailable fields silently. Correlated ticks collapse into encounters. Reviewers can reproduce every finding from the same artifact hashes and versions. No combined “cheat score” exists yet.

---

## Sprint 3 — Calibrate across demos

**Outcome:** turn evidence into an honest, measured review priority with an insufficient-data state.

**Status:** complete for controlled-fixture research evaluation; real-population validation remains explicitly unclaimed. See `docs/sprints/sprint-3-execution.md`.

### Parallel tracks

- **Ground truth and governance:** consented clean sessions, controlled known configurations, blinded expert clip review, label disagreement and provenance; reports are not positive labels.
- **Modeling:** interpretable logistic/empirical-Bayes or monotonic GAM baseline; hierarchical tick→encounter→demo→player aggregation; per-detector/encounter caps; cross-demo persistence.
- **Evaluation:** player-and-time/server separated splits, isotonic/Platt calibration, reliability curves, Brier/log loss, PR curves, false positives per 1,000 players, prevalence-aware PPV, bootstrapped player-level intervals, distribution-shift slices.
- **Adversarial/fairness:** high skill, high ping, unusual sensitivity/input devices, protocol gaps, server mods, maps/versions, smoothed/delayed/randomized assistance.

### Deliverables

`packages/scoring`, dataset/model cards, reproducible training/evaluation command, immutable model bundle, calibration report, operating-policy ADR, and score contract v1.

### Exit gate

A held-out evaluation supports at least one useful review operating point with a predeclared false-positive budget. Numeric priority is withheld below minimum independent evidence. `highly-anomalous` requires adequate reconstruction plus persistence across demos or two orthogonal signal families. If calibration is poor, ship ranked evidence without probabilities.

---

## Sprint 4 — Ship the review workbench

**Outcome:** a reviewer can ingest, triage, inspect, annotate, compare, and export a reproducible case locally.

**Status:** complete. See `docs/sprints/sprint-4-execution.md` for the real-boundary acceptance evidence and independent audit.

### Parallel tracks

- **Jobs/API/storage:** SQLite persistent job state, content-addressed files, idempotent engine subprocesses, cancellation/retry, range endpoints, OpenAPI contracts, signed/local artifact access, SSE progress, audit events.
- **Case UI:** demo/player tables, filters, cross-demo case view, quality/uncertainty, contributions and counterevidence, review notes/status, accessible responsive design.
- **Evidence playback:** canonical tick transform, zoomable timeline lanes, synchronized 2D Canvas tactical view with floors, poses/trails/FOV/shots/LOS, charts, keyboard control, deep links.
- **Performance/e2e:** chunk/downsample telemetry, virtualize tables, lazy routes, large-demo budgets, corrupted/retried job scenarios, Playwright reviewer journeys and accessibility checks.

### Deliverables

`apps/api`, `apps/worker`, production UI routes, storage package, database migrations, OpenAPI document/client, report manifest/export, local Docker option, operations guide, screenshots.

### Exit gate

From an allowlisted URL or local file, a reviewer reaches any finding, sees five–ten seconds of context and strongest benign explanation, compares corroborating demos, records a decision, and exports a hash-verifiable report. Whole telemetry files are never sent to the browser. No action is taken against a player.

---

## Sprint 5 — Harden and validate in shadow mode

**Outcome:** prove operational safety and scientific stability before any real moderation workflow relies on the tool.

### Parallel tracks

- **Security/reliability:** parser fuzz campaign, SSRF/archive regression suite, resource isolation, auth/RBAC, rate limits/quotas, backup/restore, retention/deletion, audit integrity, dependency/SBOM/license review.
- **Shadow evaluation:** prospective, blinded review with no enforcement; disagreement adjudication, alert volume, reviewer time, drift/calibration monitoring, false-positive incident playbook.
- **Scale:** profile representative workloads; add PostgreSQL/S3 and only then a multi-worker queue if measured demand requires it; preserve idempotency and local mode.
- **Optional rendering spike:** licensed L4D2 worker generates short clips with game/build/map/config/render hashes. Compare observer/POV semantics. Kill the feature if automation, rights, or fidelity is inadequate.

### Deliverables

Threat-model sign-off, deployment/runbooks, SLOs and dashboards, privacy/retention policy, public methodology/model limitations, shadow-mode report, incident/appeal process, release checklist, and optional clip-render ADR.

### Exit gate

Security tests and restore drill pass; prospective calibration remains inside predeclared tolerances; subgroup/context errors are documented; reviewers can trace and correct every result; retention and appeals work; maintainers explicitly decide whether the tool remains research-only, proceeds as decision support, or needs another validation cycle. Automated bans remain out of scope.
