# L4DStats product audit

This audit grades the real analysis experience, not fixture screenshots. A
dimension reaches 5/5 only when a real CEDAPug demo proves the full path from
network data to understandable UI.

## Benchmark

The csstats.gg match model sets a useful floor: immediate match context,
scoreboard first, advanced player statistics, round-by-round story, weapon and
duel breakdowns, and drill-downs that explain aggregate values. Its public
description explicitly emphasizes base plus advanced scoreboard statistics and
round details including outcomes and kill feeds. Automated Playwright access to
the supplied match was blocked by Cloudflare verification, so undocumented tab
contents are not treated as observed evidence.

L4DStats must go further for L4D2's asymmetric Versus structure: both team
halves, Survivor resource/health/progression efficiency, SI life and attack
impact, Tank/Witch sequences, pins and saves, class/weapon matchups, and a
tick-addressable match story.

## Baseline grade - 2026-07-17

| Dimension                |     Grade | Evidence                                                                                                        |
| ------------------------ | --------: | --------------------------------------------------------------------------------------------------------------- |
| Statistical depth        |       1/5 | Duration, movement, generic event totals, field coverage, and aim windows only.                                 |
| L4D2/Versus relevance    |       1/5 | No side halves, SI classes, pins, incaps, Tank/Witch, Survivor deaths, CI/SI kills, or score.                   |
| Correctness/provenance   |       2/5 | Good hashes/availability, but user IDs did not correlate with death events and class IDs were opaque.           |
| Information architecture |       2/5 | Clean tabs, but movement led the overview and the event tab exposed parser internals rather than match meaning. |
| Drill-down/story         |       1/5 | No timestamped match timeline or causal path from totals to events.                                             |
| Honest limitations       |       3/5 | Quality coverage was visible, but unavailable gameplay metrics were not explained where users needed them.      |
| **Overall**              | **1.7/5** | Visually coherent, statistically next to worthless.                                                             |

## Current implemented improvement

- Normalized real SourceTV user IDs so game events correlate to privacy-safe
  player aliases.
- Named L4D2 classes instead of exposing numeric `zombie-class:*` values.
- Retained health/incap/ghost state, pin relationships, checkpoint total-kill and SI
  counters, pounce/Jockey metrics, revive/incap counters, and Tank frustration.
- Added Survivor/SI deaths, SI kills per player/class/weapon, headshots,
  checkpoint total infected kills, revives, SI incaps, pounces, pin/ghost time,
  Tank/Witch deaths, and a
  timestamped positional death/team/round timeline.
- Added reset-aware half scoreboards with complete-roster damage shares,
  Survivor resource and Witch output, class-specific infected output, SI lives,
  hit clusters, confirmed death-correlated clears, and Tank encounters.
- Corrected hit-cluster health derivation after fresh-demo audits proved that
  v2 counted the 300-point incapacitation pool and v4 could count health lost,
  healed, and lost again more than once. Derivation v6 measures maximum
  contiguous drawdown per upright Survivor, validates permanent health in the
  0 to 100 range, clips clusters to non-overlapping windows, and caps the team
  bound at 400 HP. Older HP remains unavailable until reanalysis.
- Added real Witch entity lifetimes with network rage, wander-rage, burning,
  enraged ticks, and bounded death correlation. Cell-relative Witch origins are
  explicitly excluded from BSP overlays until world normalization can be
  validated.
- Added bounded per-player Survivor health traces with permanent health, raw
  temporary-health buffer, incap markers, source coverage, and explicit
  lower-bound sampling semantics.
- Added player-resource loadout traces for primary weapon, first-aid and
  temporary-health possession, with named L4D2 weapon IDs, material-change
  history, per-field coverage, half filtering, and explicit non-use semantics.
- Added sampled active-weapon clip and reserve curves with explicit coverage
  and a strict no-shot-inference boundary.
- Added the experimental, role-aware L4DStats Match Rating v0.2 and MVP model
  with opportunity normalization, exposure shrinkage, missing-data gates,
  component explanations, selected-map recomputation, and a published
  scientific validation boundary.
- Corrected the misleading `m_checkpointSurvivorDamage` direction against the
  real Hard Rain class counters. Survivor rating now uses only supported
  Survivor output, observed zero-variance metrics remain neutral and covered,
  and composite counters require complete component availability. All eight
  `915679` players now receive two-role ratings with full model-input coverage.
- Added replace-state tick drill-downs from SI hits, Tank and Witch encounters,
  Survivor incap markers, signals, and positioned spatial events. Multi-map
  reports render one spatial coordinate system per map rather than combining
  unrelated world coordinates.
- Added metric-level provenance badges for direct game events, engine counters,
  sampled state, deterministic derivations, and unavailable values across
  player, half-scoreboard, encounter, signal, and quality views.
- Added an in-product capability matrix covering supported identity, Versus,
  combat, and lineage evidence alongside explicit accuracy, exact-damage,
  skill-event, private-input, and verdict limitations.
- Added neutral Roster A/B reconstruction across observed side swaps, with
  per-half side paths, map context, membership confidence, and no unsupported
  mapping to engine score indices.
- Reconstructed privacy-safe multi-map game sessions from embedded server,
  roster, campaign, chapter, and server-generation evidence. Game reports use
  stable Steam identity for cross-map player aggregation and preserve
  unavailable values.
- Reconstructed cumulative map scores on the canonical adjacent chapter
  sequence before applying filters, and removed chapter-score double counting
  from the progression chart.
- Added bounded Valve LZMA lump decoding to the local BSP extractor, explicit
  codec provenance, floor slicing, zoom, selectable combat markers, and a
  one-map-at-a-time spatial workspace. The anonymous dedicated-server depot
  was validated across all 57 official campaign chapters: 1,886,327 triangles
  and 2,418,397 vertices were extracted from 1,468,287,000 source bytes, then
  re-hashed and bounds-checked. Real Hard Rain browser tests serve all four
  matching artifacts, switch between them, and verify substantive geometry
  plus positioned event-marker pixels on every canvas.
- Added a reusable raw-coordinate audit. Across the four exact `915679` demos,
  all 385,940 observed player positions fall inside their matching official
  BSP artifact bounds. This proves coordinate-system compatibility for the
  audited corpus without pretending the demo identifies its historical BSP
  revision.
- Replaced the generic event-count page with L4D2 combat and match-story views.
- Added [the demo-data contract](../DEMO-DATA.md), including explicit limits.

## Historical re-grade after the first real-demo iteration

| Dimension                |     Grade | Evidence                                                                                                                              |
| ------------------------ | --------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| Statistical depth        |       4/5 | Score/half state, eight-player two-sided scoreboard, combat/class/weapon distributions, resources and checkpoint counters.            |
| L4D2/Versus relevance    |       4/5 | CI/SI output, spawns, pins, incaps, revives, Tank control/outcome, and side swaps are first-class.                                    |
| Correctness/provenance   |       4/5 | User-ID correlation fixed and real CEDAPug artifact verified; ambiguous raw counters retain exact property names and explicit limits. |
| Information architecture |       4/5 | Score and outcome lead; movement/parser internals removed; player, combat, story, signals, and quality are separated.                 |
| Drill-down/story         |       4/5 | Expandable player records plus filterable 142-moment tick timeline on the audited demo.                                               |
| Honest limitations       |       4/5 | Capability contract and legacy reanalysis are explicit; metric-level provenance affordances still need strengthening.                 |
| **Overall**              | **4.0/5** | A useful L4D2 match report; not yet the 5/5 target.                                                                                   |

Those first-iteration gaps drove the final exit-gate work below. Unsupported
semantic plays remain explicit unavailable states rather than inferred totals.

## 5/5 exit criteria

| Dimension           | Required proof                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Match context       | Map/chapter, duration, both Versus halves, teams, score/progression, round outcome, Tank/Witch presence.                                   |
| Survivor scoreboard | CI/SI kills, deaths/incaps, revives/saves, health/resource efficiency, weapons, accuracy/damage only where source data supports it.        |
| Infected scoreboard | Lives/classes, pins and duration, incaps/kills, class-specific attacks, spawn/ghost efficiency, Tank control/rocks/punches where reliable. |
| Combat              | Player/class/weapon attribution with aggregate-to-event drill-down and no fabricated damage/accuracy.                                      |
| Story               | Filterable tick-addressed timeline for rounds, deaths, pins, incaps, saves, Tank/Witch, and major swings.                                  |
| Review              | Evidence moments remain secondary, explainable, replayable, and separated from match statistics.                                           |
| Quality             | Every metric exposes observed/derived/unavailable semantics and old artifacts degrade clearly.                                             |
| UX                  | Responsive, accessible, fast, shareable, and visually verified on a real persisted analysis.                                               |

A release reaches 5/5 only when every row above has real-demo evidence. Metrics
that SourceTV fundamentally does not carry cannot be invented; a 5/5 product
must make that limitation useful and still maximize every reliable entity-state
signal.

## Current held-out audit - 2026-07-18

The previous 5/5 label was not defensible. A fresh, previously unused CEDAPug
game exposed an incap-health error after the existing suite was green. This
section replaces that label and keeps unproved claims below 5/5.

The held-out boundary is complete Hard Rain game `916237`, downloaded from the
CEDAPug demo index on 2026-07-18. Its four demos group into one game, order as
`c4m1` through `c4m4`, resolve eight stable Steam identities, reconstruct both
halves per chapter, and produce a final score of `1,097 : 1,611`. The CEDAPug
JSON export independently confirms the four maps and eight identities. Its
plugin statistics are not imported as demo evidence.

| Dimension                |     Grade | Current evidence and remaining gap                                                                                                                                                                  |
| ------------------------ | --------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statistical depth        |     4.5/5 | Two-role players, score, combat, resources, SI lives, health, Tank/Witch, ratings and awards are useful. Accuracy and several plugin-only skill events remain absent.                               |
| L4D2/Versus relevance    |     4.7/5 | Side swaps, chapter sequence, pins, incaps, clears, SI classes and Tank control are first-class. Some counters still need independent semantic reconciliation.                                      |
| Correctness/provenance   |     4.5/5 | All 22 demos and 231,337 outer commands match pinned UntitledParser exactly. Fresh game 916532 validates v6 HP bounds, identities and total-kill semantics. No licensed player-state oracle exists. |
| Information architecture |     4.7/5 | Score/MVP lead, scoped consolidated tables, one-map combat and timeline controls, and shareable routes are coherent.                                                                                |
| Drill-down/story         |     4.5/5 | Tick links, tracks and encounter records provide a strong story. Authentic playback and exact attacker attribution are unavailable.                                                                 |
| Honest limitations       |     4.8/5 | Provenance and unavailable states are visible. This corrected audit now records the independent-validation and hosted-operation gaps.                                                               |
| UX                       |     5.0/5 | Fourteen desktop/mobile journeys pass with no sub-24px effective controls; a fresh browser/API/worker/SQLite boundary passes every tab at 390x844 with no overflow or sub-11px text.                |
| **Product overall**      | **4.7/5** | Strong local competitive match report with independently validated framing, not yet perfect.                                                                                                        |
| **Production readiness** | **4.9/5** | Compiled services, roles/quotas, fail-closed seccomp parsing, health propagation, recovery, retention, deployment and dependency gates pass. Live hosted drills remain.                             |

Fresh derivation-v6 validation is recorded in
`docs/sprints/cedapug-v6-validation-916532.json`. The held-out three-map game
contains 61 hit clusters with no overlapping windows; its per-map maximum team
health drawdowns are 56, 127 and 151 HP. All competitive identities resolve.
The final map contains nine entity epochs because one known Steam identity
reconnects, and game aggregation correctly presents eight unique competitive
participants. The same game now passes the complete browser, API, worker,
parser and SQLite path in 3.8 minutes. Its persisted report was audited on all
six tabs at 390x844 with zero document overflow and zero visible text below
11px. That run exposed and corrected an unwrapped shared-MVP row, a non-root
worker-heartbeat path, and orphan child processes after boundary-runner
failure.

Fresh complete CEDAPug game `916532` proved `m_checkpointZombieKills` is not a
CI counter. For six of eight players, its excess over plugin
`GunStats.all.CommonKill` exactly equalled independently attributed SI kills.
The other two retained residuals of one and seven kills, demonstrating that
subtracting the incomplete SourceTV SI death stream is not a safe CI
reconstruction. The product now calls this checkpoint total infected kills,
removes it from L4DStats Rating v0.2, and makes CI unavailable rather than
publishing a fabricated split. Pills matched the plugin exactly for all eight
players. The melee checkpoint matched plugin melee common kills for seven and
was one higher for the eighth, so it remains broadly labelled melee kills.

### Correctness finding: hit-cluster HP

Competitive derivation v2 included the 300-point incapacitation pool in
permanent-health loss. The held-out c4m1 replay proved the error: one cluster
changed from 351 to 41 HP under v3, and another changed from 144 to 25. Clean
windows retained values such as 117, 24, 16, 30 and 2. A later audit found
stored v3 artifacts with life-long windows despite the current bounded-window
implementation. A further production audit found impossible 470 HP values
because v4 summed every downward step, including repeated loss after healing.
V6 now:

- counts only finite, distinct-tick, alive and upright health states in the
  valid 0 to 100 permanent-health range;
- measures maximum contiguous drawdown per Survivor instead of gross downward
  movement;
- excludes incap-pool depletion and transitions into or out of incap;
- clips adjacent hit windows so one health transition cannot count twice;
- caps each window at eight seconds after the final grouped spawn;
- rejects missing or invalid tick intervals instead of creating an unbounded
  window;
- reports HP unavailable without two eligible samples; and
- caps the four-Survivor team bound at 400 HP; and
- requires reanalysis before displaying v1 through v5 HP.

The UI calls this maximum observed team permanent-health drawdown. It does not
call it SI damage or exact net HP loss. Unrelated damage inside the bounded
window can still contribute because SourceTV does not provide an attributable
hurt event in this corpus.

### Release blockers

1. Run licensed playback state comparisons before claiming empirical entity
   reconstruction accuracy. Independent outer framing passed against pinned
   UntitledParser across all 22 demos and 231,337 commands with zero
   differences; see `docs/sprints/sprint-1-independent-framing.json`.
2. Reconcile additional checkpoint counters when an independent export exposes
   a genuinely equivalent scope. Common-kill semantics are now resolved and
   corrected; damage counters remain explicitly engine-scoped rather than
   claimed equal to CEDAPug gun-only damage.
3. Complete the remaining hosted Sprint 5 operations gates: a live
   production-container restore drill and deployment of the implemented
   Prometheus monitoring integration to an operator-controlled monitor.
   Private single-user authentication, API authentication, mutation and auth
   failure limits, transactional retention/deletion, checksummed backup and
   restore tooling, a pinned production stack and a clean dependency audit are
   implemented.
4. Complete prospective blinded shadow evaluation before using anomaly scores
   for moderation. The controlled-fixture model remains research-only.

Until those gates pass, L4DStats is suitable as a local match-analysis and
research workbench. It is not production moderation decision support.

### Release-gate evidence - 2026-07-18

- `pnpm format:check`, `pnpm check`, `pnpm test` and `pnpm build` pass. The
  complete test run exercised 22 real SourceTV demos and the 154-second worker
  integration replay.
- All 14 Playwright journeys pass at desktop and 390-by-844 mobile viewports,
  including upload limits, persisted routes, grouped games, map scoping,
  accessible controls and reduced motion. The complete mobile results journey
  also rejects any visible button, disclosure or effective checkbox target
  smaller than 24 by 24 CSS pixels.
- Full-page mobile screenshots were reviewed across overview, players, combat,
  timeline, signals and data coverage. Redundant header spacing was removed,
  and the eight compact overview/combat totals now use tested two-column phone
  layouts. Detailed distributions, hit evidence and leaderboards remain
  full-width where names and explanations require it. The production CSS stays
  exactly within its 77,824-byte budget.
- The production web authentication/proxy regression passes against compiled
  assets. The API suite covers bearer authentication, auth-failure limiting,
  mutation limiting and public health checks.
- The compiled-stack regression starts production exports, proves SQLite
  readiness through the authenticated web boundary, stops the API, and proves
  the public probe changes to failure. The authenticated Prometheus boundary
  exposes privacy-safe readiness, response-class, latency, durable job-state,
  queue-age, rejection, throttling and worker-heartbeat metrics. Tests prove
  that paths, idempotency keys and demo hashes are absent. The worker has a
  15-second stale heartbeat health gate. The production response runbook
  defines alert expressions, thresholds, triage, recovery checks and closure
  evidence.
- The parser boundary uses a direct compiled Node process in production,
  removes service credentials, denies networking with an architecture-checked
  seccomp launcher, restricts reads/writes/processes through Node permissions,
  caps Node heap and Linux address space, CPU, file descriptors, core dumps,
  output and wall time, and escalates process-group termination from TERM to
  KILL. Adversarial tests cover cancellation, ignored termination, output
  flooding and secret inheritance.
- Fresh CEDAPug `c8m1_apartment` completed through the exact compiled seccomp,
  Node-permission and `prlimit` boundary with eight player epochs and
  derivation v6. The
  complete two-demo worker correlation replay then passed in production mode
  under the same limits. Every workspace package now resolves built JavaScript
  under the production export condition; the audit caught and removed the
  prior implicit Node TypeScript/Wasm fallback.
- `pnpm security:check` reports no known vulnerabilities and accepts every
  resolved dependency license category against the reviewed allowlist.
- `compose.production.yaml` passes `docker compose config --quiet` with Docker
  Compose v5.3.1 on ARM64. Its Node base is pinned by a multi-architecture
  digest and only the authenticated web service publishes a host port. A
  daemon-independent release script now renders the full interpolated model
  with either the Compose plugin or standalone Compose and asserts service,
  port, read-only filesystem, capability and privilege-escalation invariants.
- Storage retention tests and an isolated real SQLite/artifact purge pass.
  Backup, restore and retention shell entry points pass syntax checks.
- The automated recovery drill creates a migrated workbench database and
  artifact, verifies checksum and archive-member safety, restores into a clean
  root, proves exact database/artifact hashes, reopens durable state through the
  production storage package and rejects a corrupted archive. A live
  production-container drill was attempted with an isolated Docker 29.1.3
  daemon using the `vfs` driver, disabled networking and disabled iptables. The
  daemon initialized and Compose resolved, but the kernel rejected build
  namespace creation with `unshare: operation not permitted` because this
  sandbox's bounding set excludes `CAP_SYS_ADMIN`. No production container was
  created. Exact evidence is retained in
  `docs/sprints/production-container-drill-2026-07-18.json`.
