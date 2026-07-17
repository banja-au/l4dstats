# Sprint 2 execution

- Status: blocked at inherited real-telemetry prerequisite
- Started from revision: `cf965e0`
- Current tested revision: `cf965e0`, clean worktree before this ledger
- Selected because: explicitly requested by the user
- Environment: Ubuntu 24.04 arm64; Node `v24.16.0`; pnpm `11.13.1`; ten ignored SourceTV protocol-2100 fixtures available
- Next action: resolve the real `instancebaseline` payload interpretation, establish corpus baseline/entity goldens, and rerun ADR 0003's telemetry gate

## Contract

Outcome (verbatim): **emit explainable, independently testable evidence windows without claiming a probability.**

| Gate ID | Original clause (verbatim)                                                        | Interpretation                                                                                                     | Verification                                        | Status  |
| ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------- |
| P0      | Sprint 2 and all scoring work are blocked until the Sprint 1 telemetry gates pass | Detectors cannot be validated on real demos until NET/SVC, tables, entities, and required player state are decoded | Ten-demo canonical telemetry report and updated ADR | blocked |
| G1      | Every detector produces tick range                                                | Evidence windows have valid bounded source ranges                                                                  | Contract/unit/real-fixture assertions               | passed  |
| G2      | raw features                                                                      | Findings retain detector inputs sufficient to recompute the result                                                 | Schema and snapshot tests                           | passed  |
| G3      | effect size/contribution placeholder                                              | Findings expose an interpretable non-probabilistic magnitude                                                       | Detector tests                                      | passed  |
| G4      | quality                                                                           | Findings quantify reconstruction/input quality independently of anomaly                                            | Missing/corrupt telemetry tests                     | passed  |
| G5      | explanation                                                                       | Every finding has a human-readable causal explanation                                                              | Registry/contract assertions                        | passed  |
| G6      | limitations                                                                       | Detector prerequisites and known failure modes are emitted                                                         | Detector cards and tests                            | passed  |
| G7      | counterevidence                                                                   | Strongest benign explanations are emitted with each finding                                                        | Detector tests                                      | passed  |
| G8      | No detector consumes unavailable fields silently                                  | Required availability is enforced; unavailable inputs skip with reasons                                            | Adversarial missing-field tests                     | passed  |
| G9      | Correlated ticks collapse into encounters                                         | Segmentation merges temporally/causally related samples and caps pseudoreplication                                 | Property/unit/benchmark tests                       | passed  |
| G10     | Reviewers can reproduce every finding from the same artifact hashes and versions  | Evidence records demo/config/detector/asset provenance and deterministic features                                  | Double-run real/synthetic artifact hash             | partial |
| G11     | No combined “cheat score” exists yet                                              | No player-level probability/score aggregation is implemented or exposed                                            | API/code audit                                      | passed  |

## Dependencies and non-goals

- P0 is an inherited hard dependency from accepted ADR 0003. Crossing it is prerequisite work, not permission to weaken Sprint 2.
- Raw fixtures remain ignored. New external inputs require authorization, provenance, bounds, and retention controls.
- No probability, player-level cheating score, ban decision, public accusation, or detector threshold optimization.
- Exact BSP visibility may ship as quality-gated geometry interfaces/fixtures only if licensed map assets are unavailable; awareness detectors must skip rather than infer hidden visibility.

## Baseline

| Command                                                      | Exit | Result/artifact                             | Pre-existing issue                                                                 |
| ------------------------------------------------------------ | ---: | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Initial direct `pnpm format:check`, `check`, `test`, `build` |    1 | `/tmp/s2-*.log`, shared SHA-256 `72e25b45…` | pnpm required a non-interactive `node_modules` relink after Corepack state changed |
| `CI=true pnpm install --frozen-lockfile`                     |    0 | `/tmp/s2-install.log`                       | repaired environment without a lockfile change                                     |
| `pnpm format:check` after relink                             |    1 | `/tmp/s2-format2.log`                       | only this new ledger was unformatted                                               |
| `pnpm check` after relink                                    |    0 | `/tmp/s2-check2.log`                        | none                                                                               |
| `pnpm test` after relink                                     |    0 | `/tmp/s2-test2.log`                         | none                                                                               |
| `pnpm build` after relink                                    |    0 | `/tmp/s2-build2.log`                        | none                                                                               |

## Work log

- 2026-07-17: Created ledger before mutation. Worktree was clean at `cf965e0`.
- 2026-07-17: Started three non-overlapping tracks: L4D2 NET/SVC/entity prerequisite, quality-gated geometry/context, and explainable detectors/encounter segmentation. The lead owns canonical contracts, CLI integration, workspace config, docs, and final synthesis.
- 2026-07-17: Geometry/context completed with 20 tests. Visibility refuses unversioned/missing map geometry, dynamic-state gaps lower quality, floor ambiguity remains explicit, tick time honors pauses, and audibility is only a qualified proxy.
- 2026-07-17: Detector engine completed with 15 tests and a 100,000-sample benchmark. Added four versioned detector cards, explicit skips, non-probabilistic effects, quality bases, limitations/counterevidence, provenance, and encounter segmentation. Reconciled package types with canonical evidence schema v1.
- 2026-07-17: Feature explorer CLI now lists cards and runs a versioned request into deterministic evidence/encounters. A tracked synthetic fixture produces one explainable aim window; unavailable inputs produce explicit skips.
- 2026-07-17: P0 advanced through bounded NET/SVC identification, redacted ServerInfo, snapshot string tables/userinfo, per-demo instancebaseline transport, and complete data-table schemas. All ten demos agree on 17 string tables, 32 userinfo slots, 407 send tables, 5,426 send props, and 278 server classes. Dynamic epochs and player state remain blocked at schema flattening/baseline/property-delta decoding; a fresh specialist is continuing that exact boundary.
- 2026-07-17: Implemented exact flattening, bounded property/value decoding, baseline association, packet-entity envelopes and update APIs, plus three strict entity tests. A real baseline oracle still fails: class/key 261 maps to `CWorld` with 63 props but decodes indexes 0 then 161 and never reaches a terminator. Two independent MIT implementations agree with the field-index algorithm. ADR 0004 records the blocked exit without weakening it.

## Exit-gate evidence

| Gate ID     | Revision | Exact command                                                                                                         | Exit | Evidence/artifact hash                                      | Fixture/provenance                                                 | Prerequisites                    | Result                                   |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------- | ---: | ----------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- | ---------------------------------------- |
| G1-G9, G11  | worktree | `pnpm test`                                                                                                           |    0 | 37 demo-source1, 20 geometry, 15 detector, 4 CLI tests pass | synthetic/adversarial plus ten quarantined demos for parser layers | real detector inputs unavailable | passed within available scope            |
| G10         | worktree | run detector cards and synthetic feature fixture twice; `cmp` outputs                                                 |    0 | cards `72440308…`; features `4f86f789…`                     | tracked versioned synthetic request                                | no real player telemetry         | synthetic deterministic; real blocked    |
| performance | worktree | `pnpm --filter @witchwatch/detectors benchmark`                                                                       |    0 | 100,000 aim samples mean 67.94 ms                           | synthetic benchmark                                                | none                             | passed                                   |
| workspace   | worktree | `pnpm format:check && pnpm check && pnpm test && pnpm build`                                                          |    0 | all eight packages passed                                   | full workspace                                                     | none                             | passed                                   |
| P0          | worktree | `pnpm --filter @witchwatch/demo-source1 exec vitest run src/corpus.integration.test.ts -t "instancebaseline blocker"` |    0 | expected RangeError: property index 161 outside 63          | first sorted quarantined protocol-2100 SourceTV fixture            | valid baseline decoding          | blocker reproduced without failing suite |

## Decisions and risks

- Current fixtures are all SourceTV protocol 2100. Direct user commands remain unavailable even if network entity telemetry is recovered.
- Licensed L4D2 map assets and native playback are not present in this container.

## Independent audit

An independent read-only auditor reran the full workspace gate, detector benchmark, deterministic CLI double-runs, ignore/staging audit, contract audit, and Sprint 2 claim audit. After requesting a reproducible P0 oracle and reconciliation of the skip contract, both were added. The audit confirmed that the repository is safe to commit as **blocked Sprint 2 progress**, not as sprint completion. Its benchmark rerun averaged 69.63 ms per 100,000 aim samples; timing variance does not affect the functional gate.

## Out-of-scope follow-up

- Add suitably licensed heterogeneous protocol/POV fixtures; the current corpus covers only protocol-2100 SourceTV.
- Perform selected-tick comparison with licensed L4D2 playback on compatible infrastructure after entity reconstruction works.
- Exact BSP visibility remains unavailable without versioned licensed map assets; awareness detectors skip when authoritative visibility is absent.
