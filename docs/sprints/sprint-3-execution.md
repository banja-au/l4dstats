# Sprint 3 execution

- Status: complete
- Started from revision: `90a7067`
- Current tested revision: `90a7067` plus the complete Sprint 3 diff; all final gates and the independent re-audit pass.
- Selected because: the user explicitly requested Sprint 3 after Sprint 2 was completed at `7195098`; ADR 0003's amendment permits calibration development while retaining `reference-validation-pending` as a mandatory limitation.
- Environment: Linux arm64 container; Node `v24.16.0`, pnpm `11.13.1`; 22 ignored CEDAPug demos are available under `data/sprint-1-corpus/extracted`.
- Next action: commit the audited Sprint 3 tree.

## Contract

Outcome (verbatim): **turn evidence into an honest, measured review priority with an insufficient-data state.**

| Gate ID | Original clause (verbatim)                                                                                           | Interpretation                                                                                                                                                                                 | Verification                                                                                                              | Status |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ |
| G1      | A held-out evaluation supports at least one useful review operating point with a predeclared false-positive budget.  | A deterministic, player-separated held-out evaluation must meet a policy threshold declared before evaluation; the dataset must have auditable provenance and limitations.                     | Reproducible training/evaluation command, immutable bundle, evaluation report, and tests for split isolation and metrics. | pass   |
| G2      | Numeric priority is withheld below minimum independent evidence.                                                     | The public score contract must have an explicit insufficient-data variant with no numeric priority, and aggregation must count independent encounters/demos/signal families rather than ticks. | Unit/property tests and CLI artifact inspection.                                                                          | pass   |
| G3      | `highly-anomalous` requires adequate reconstruction plus persistence across demos or two orthogonal signal families. | Policy code must enforce both reconstruction quality and either cross-demo persistence or orthogonal-family corroboration.                                                                     | Decision-table tests including every failing prerequisite and qualifying path.                                            | pass   |
| G4      | If calibration is poor, ship ranked evidence without probabilities.                                                  | Evaluation must apply a predeclared calibration-quality gate and emit a probability-free ranked-evidence bundle when it fails.                                                                 | Deterministic poor-calibration fixture and contract/CLI tests.                                                            | pass   |

## Deliverables

- `packages/scoring`
- Dataset and model cards
- Reproducible training/evaluation command
- Immutable model bundle
- Calibration report
- Operating-policy ADR
- Score contract v1

## Baseline

| Command                                  | Exit | Result/artifact                                                                    | Pre-existing issue                                                                                                       |
| ---------------------------------------- | ---: | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `git status --short`                     |    0 | clean after required pre-sprint commit `90a7067`                                   | none                                                                                                                     |
| `pnpm format:check`                      |    1 | pnpm requested a non-interactive modules-directory rebuild before running Prettier | dependency tree created by a different pnpm/modules configuration; restore with `CI=true pnpm install --frozen-lockfile` |
| `CI=true pnpm install --frozen-lockfile` |    0 | restored 132 pinned packages; lockfile unchanged                                   | none                                                                                                                     |
| `pnpm format:check`                      |    0 | all matched files use Prettier style after formatting this ledger                  | none                                                                                                                     |
| `pnpm check`                             |    0 | 8/8 package type-check tasks passed                                                | none                                                                                                                     |
| `pnpm test`                              |    0 | 12/12 tasks passed, including all ignored real-corpus tests                        | none                                                                                                                     |
| `pnpm build`                             |    0 | 8/8 production build tasks passed                                                  | none                                                                                                                     |

## Scope and interpretations

- Reports are not positive labels. Training labels must be consented/controlled/blinded-review labels with provenance; CEDAPug demos may exercise inference paths but are not ground-truth positives.
- A calibrated value is a review-priority estimate, never proof or an enforcement trigger.
- Because licensed playback comparison is pending, every Sprint 3 model/report carries `reference-validation-pending` and is research-only.
- The sprint will provide a small redistributable synthetic/controlled calibration dataset. It will not claim population validity from the current homogeneous 22-demo SourceTV corpus.
- Tick-level samples will not enter train/test independently; splitting and bootstrap units are player-level.

## Work log

- 2026-07-17: committed all pre-sprint Docker/dev/validation changes as `90a7067` before beginning Sprint 3, as explicitly requested.
- 2026-07-17: established the Sprint 3 gate contract and recorded the dependency-tree baseline issue.
- 2026-07-17: restored the frozen dependency tree and passed the full pre-change quality baseline.
- 2026-07-17: froze score schema v1 as a discriminated union: insufficient and ranked-evidence outputs structurally cannot contain numeric review priority; only calibrated output can.
- 2026-07-17: completed three independent pre-implementation reviews covering scoring design, governance, and adversarial acceptance. All identified synthetic-fixture generalization as the primary scientific risk.
- 2026-07-17: implemented `packages/scoring` with hierarchical caps, deterministic logistic/Platt fitting, player/server-time split isolation, calibration and PR metrics, player bootstrap intervals, policy gates, and canonical SHA-256 bundles.
- 2026-07-17: added a deterministic 120-player synthetic controlled-fixture generator (40 train, 40 calibration, 40 held-out) plus an inverted held-out fixture that forces calibration failure.
- 2026-07-17: added `l4dstats calibrate` and `pnpm scoring:evaluate`; two consecutive runs published the same immutable model/report hashes.
- 2026-07-17: published model `a267f1a8a5c7e17eacf3e4ba4f17de9dd6b2ef99a77447a27c9fa14a97ceb010` and report `c5cf711d8d7d6d12fce99e38c9bea1e991f2faa2d8fcec48e26a63c0d73ee48b`.
- 2026-07-17: the deliberately inverted held-out fixture produced `calibrationAccepted: false` and `usefulOperatingPoint: false`; policy tests prove the resulting player output is `ranked-evidence` with no numeric priority.
- 2026-07-17: expanded the ignored corpus from 10 to 22 demos. The full gate exposed fixed-size Sprint 2 assertions; repaired them to validate every available demo while preserving the original ten-demo golden minima. Uncached decoder/projection tests pass over 231,183 entity frames and 3,271 events across all 22 demos.
- 2026-07-17: sharded the long real-telemetry corpus test into four worker files; all 18 files and 78 parser tests now finish successfully without Vitest RPC timeout.
- 2026-07-17: the first independent audit rejected zero-valued evidence, missing numeric-output prerequisites, implicit orthogonality, split-derived family IDs, stale lineage, and contradictory threshold wording. Each finding was repaired and regression-tested before the final audit.
- 2026-07-17: the re-audit found that card-declared manifest fields were not fully materialized. The generator now emits the split digest, per-split/per-label player, encounter, and fixture-family counts, structured missingness and reconstruction applicability, and a versioned exclusion schema.

## Exit-gate evidence

| Gate ID | Revision                  | Exact command                                                                                                                          | Exit | Evidence/artifact hash                                                 | Fixture/provenance                                                                                         | Prerequisites                                               | Result                                                                                        |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---: | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| G1      | `90a7067` + Sprint 3 diff | `pnpm scoring:evaluate` twice                                                                                                          |    0 | model `a267f1a8...ceb010`; report `c5cf711d...ee48b`                   | generated controlled-v1, 120 invented player rows; 40 held out, player/server-time/fixture-family isolated | controlled-fixture scope only; reference validation pending | pass: predeclared 50 FP/1,000 and 0.60 recall budget met at 0 and 1.0; not a population claim |
| G2      | `90a7067` + Sprint 3 diff | `pnpm --filter @l4dstats/scoring test`                                                                                                 |    0 | 16/16 tests                                                            | governed synthetic evidence with explicit encounters                                                       | score schema v1                                             | pass: insufficient variant structurally lacks numeric fields; tick duplicates/caps tested     |
| G3      | `90a7067` + Sprint 3 diff | `pnpm --filter @l4dstats/scoring test`                                                                                                 |    0 | policy decision-table tests                                            | synthetic cross-demo and orthogonal-family evidence                                                        | reconstruction quality ≥ 0.8                                | pass: low reconstruction fails; persistence and orthogonal paths pass independently           |
| G4      | `90a7067` + Sprint 3 diff | `pnpm --filter @l4dstats/cli dev calibrate ../../packages/scoring/fixtures/poor-calibration-v1.json ../../data/sprint-3-poor-final-v5` |    0 | report `d49f047f...53c36`; model `603b0483...e5e09` (ignored evidence) | deliberately inverted synthetic held-out labels                                                            | calibration and operating gates frozen in policy            | pass: calibration/useful point false; ranked output contract and policy omit numeric priority |

## Decisions and risks

- The current corpus cannot honestly establish cheating prevalence or positive labels. Sprint 3 can prove the calibration machinery and policy gates on governed synthetic/controlled fixtures, but external empirical generalization remains a release-stage risk.
- The near-perfect held-out controlled-fixture separation is intentionally easy and is evidence of engineering behavior only. It does not satisfy release, moderation, population calibration, or real-player false-positive validation.
- Score application requires an upstream causal `encounterId`; ticks and detector windows cannot manufacture independence.
- The current real corpus remains homogeneous SourceTV protocol 2100 and unlabeled. It is used for parser/inference regression only.

## Independent audit

The first independent exit-gate audit failed G1 and artifact/governance evidence and
found the corpus worker timeout. Its concrete findings are recorded in the work log;
all were repaired. The final independent re-audit passed G1-G4 and every deliverable,
including canonical recomputation of the dataset and split-manifest bindings.

Final verification on the audited tree passed `pnpm format:check`, all 9 type-check
tasks, all 14 test tasks (including 18 files/78 tests over the 22-demo parser corpus),
and all 9 production build tasks. `git diff --check` and content-addressed artifact
filename verification also passed.

## Out-of-scope follow-up

- Independent parser framing comparison and licensed matching-L4D2 playback validation remain pre-release requirements.
- Prospective shadow-mode population calibration belongs to Sprint 5.
