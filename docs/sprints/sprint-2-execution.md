# Sprint 2 execution

- Status: complete; internal recovery independently audited
- Started from revision: `cf965e0`
- Current tested revision: `54f2e9b`, clean worktree at recovery start
- Selected because: explicitly requested by the user
- Environment: Ubuntu 24.04 arm64; Node `v24.16.0`; pnpm `11.13.1`; ten ignored SourceTV protocol-2100 fixtures available
- Next action: begin Sprint 3; retain UntitledParser/playback comparison as a pre-release validation task

## Contract

Outcome (verbatim): **emit explainable, independently testable evidence windows without claiming a probability.**

| Gate ID | Original clause (verbatim)                                                        | Interpretation                                                                     | Verification                                      | Status |
| ------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| P0      | Sprint 2 and all scoring work are blocked until the Sprint 1 telemetry gates pass | Real parsing/projection and deterministic evidence must pass ten demos             | Ten-demo canonical telemetry and evidence reports | passed |
| G1      | Every detector produces tick range                                                | Evidence windows have valid bounded source ranges                                  | Contract/unit/real-fixture assertions             | passed |
| G2      | raw features                                                                      | Findings retain detector inputs sufficient to recompute the result                 | Schema and snapshot tests                         | passed |
| G3      | effect size/contribution placeholder                                              | Findings expose an interpretable non-probabilistic magnitude                       | Detector tests                                    | passed |
| G4      | quality                                                                           | Findings quantify reconstruction/input quality independently of anomaly            | Missing/corrupt telemetry tests                   | passed |
| G5      | explanation                                                                       | Every finding has a human-readable causal explanation                              | Registry/contract assertions                      | passed |
| G6      | limitations                                                                       | Detector prerequisites and known failure modes are emitted                         | Detector cards and tests                          | passed |
| G7      | counterevidence                                                                   | Strongest benign explanations are emitted with each finding                        | Detector tests                                    | passed |
| G8      | No detector consumes unavailable fields silently                                  | Required availability is enforced; unavailable inputs skip with reasons            | Adversarial missing-field tests                   | passed |
| G9      | Correlated ticks collapse into encounters                                         | Segmentation merges temporally/causally related samples and caps pseudoreplication | Property/unit/benchmark tests                     | passed |
| G10     | Reviewers can reproduce every finding from the same artifact hashes and versions  | Evidence records demo/config/detector/asset provenance and deterministic features  | Double-run real/synthetic artifact hash           | passed |
| G11     | No combined “cheat score” exists yet                                              | No player-level probability/score aggregation is implemented or exposed            | API/code audit                                    | passed |

## Dependencies and non-goals

- P0's internal telemetry dependency is satisfied. ADR 0003's amendment retains external comparison as a pre-release scientific gate.
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
- 2026-07-17: User authorized a comprehensive recovery swarm to close Sprint 2 and unblock Sprint 3. Recovery starts from clean revision `54f2e9b`; accepted gates remain frozen and the blocked status will not be lifted without real-corpus telemetry and independent audit.
- 2026-07-17: Resolved the original baseline failure. L4D2 property streams interleave each field index with its value, and nested non-collapsible send-table branches must append to class-global output even beneath collapsible ancestors. Independent raw-bit forensics proved snapshot extraction correct for all 510 entries (449 unaligned). All 510/510 populated baselines now decode across ten demos with only 0–7 padding bits.
- 2026-07-17: Rejected two manufactured packet interpretations during adversarial review: the payload is not headed by an opaque 12-byte netchannel wrapper, and later apparent message envelopes from the old registry are not authoritative. Protocol 2100 uses L4D2's shifted NET/SVC table with `net_SplitScreenUser` at ID 3 and `net_Tick` at ID 4. Network traversal is being rebuilt against that branch table before entity deltas are consumed.
- 2026-07-17: Completed authoritative protocol-2100 traversal: all 104,213 payloads terminate cleanly and expose 104,183 packet-entity envelopes. Stateful reconstruction now handles enter, delta, leave, serial lifetimes, baseline slots, and L4D2's delta-coded deletion list across all ten demos.
- 2026-07-17: Added streaming canonical player projection with explicit source-property provenance and availability. The serial corpus verifier exits zero with 92 epochs and 932,553 observations over 104,183 frames; position/team/class and network pitch/yaw are complete, roll is explicitly derived as zero by network normalization, weapon class is available for 670,802 observations, and buttons remain unavailable.
- 2026-07-17: Connected real canonical observations to the aim detector with deterministic, versioned nearest-opponent selection and no inferred visibility, audibility, shot, or intent. A double run over one real demo produced 138,696 complete samples, zero manufactured findings, eight `no-candidate` skips, one missing-prerequisite skip, and stable observation/evidence hashes recorded in `sprint-2-real-evidence.json`.
- 2026-07-17: Replaced vague external follow-up with concrete UntitledParser framing and licensed-playback acceptance procedures. The current arm64 container has neither the compatible reference runner nor licensed game/build/map assets; internal decoder or detector work cannot honestly substitute for these checks.
- 2026-07-17: Added `playback-export` and `playback-compare` CLI commands. They emit redacted tick checkpoints, bind reports to demo/export/reference hashes and tool/build/map provenance, apply explicit tolerances, and exit nonzero on mismatches. A real ignored-demo smoke exported nine player checkpoints; the comparator has four focused tests.
- 2026-07-17: Fresh recovery audit rejected the “sole external blocker” claim. ADR 0003 also requires dynamic fire/damage/death event projection, and the corpus verifier did not bind entity lifetimes to pseudonymous userinfo identities. Recovery remains active on those two internal gaps. The audit also requested stricter playback input validation; schema/tick/checkpoint/metadata uniqueness checks and a fifth comparator test were added immediately.
- 2026-07-17: Closed the event gap with bounded dynamic `svc_GameEventList` schemas, all Source value types, `svc_GameEvent` decoding, and canonical schema-v1 projection with field provenance and user-ID-to-epoch correlation. Ten demos decode 10/10 lists, 385 schemas per demo, 1,437/1,437 events, and 424 `player_death` events. This SourceTV corpus contains no `weapon_fire` or `player_hurt`; their absence remains explicit and synthetic tests cover their schemas.
- 2026-07-17: Closed the identity gap with bounded create/update string-table decoding, LZSS/Snappy limits, dynamic update history, keyed HMAC-SHA256 pseudonyms, timed clears, and effective-tick epoch selection. Final snapshots backfill only slots proven untouched; changed slots stay unavailable before their first authoritative update. The serial verifier exits zero with 76 privacy-bound human epochs across ten demos and never returns or prints raw names or Steam IDs.
- 2026-07-17: Closed the remaining audit findings by validating playback schema/tick/checkpoint/availability/metadata structure and by labeling lightweight `inspect` telemetry as not evaluated instead of falsely undecoded. A final re-audit is still required.

## Exit-gate evidence

| Gate ID     | Revision | Exact command                                                        | Exit | Evidence/artifact hash                                        | Fixture/provenance                                  | Prerequisites                  | Result                                 |
| ----------- | -------- | -------------------------------------------------------------------- | ---: | ------------------------------------------------------------- | --------------------------------------------------- | ------------------------------ | -------------------------------------- |
| G1-G9, G11  | worktree | `pnpm format:check && pnpm check && pnpm test && pnpm build`         |    0 | parser 56; schema 15; detectors 19; CLI 9; all packages built | synthetic/adversarial plus quarantined real demos   | none                           | passed                                 |
| G10         | worktree | `pnpm --filter @witchwatch/detectors exec vitest run --maxWorkers=1` |    0 | observations `ec346c38…`; evidence `58d7af84…`                | real demo `299019bf…`, 138,696 complete aim samples | none                           | deterministic real no-finding artifact |
| performance | worktree | `pnpm --filter @witchwatch/detectors benchmark`                      |    0 | 100,000 aim samples mean 82.46 ms                             | synthetic benchmark                                 | none                           | passed                                 |
| workspace   | worktree | `pnpm format:check && pnpm check && pnpm test && pnpm build`         |    0 | all eight packages passed                                     | full workspace                                      | none                           | passed                                 |
| telemetry   | worktree | `pnpm --filter @witchwatch/l4d2-schema verify:corpus`                |    0 | 10 demos; 92 epochs; 104,183 frames; 932,553 observations     | ten quarantined protocol-2100 SourceTV demos        | none                           | passed                                 |
| identity    | worktree | `pnpm --filter @witchwatch/l4d2-schema verify:corpus`                |    0 | 76 privacy-bound human epochs; no raw identifiers             | timed updates and safe snapshot reconciliation      | pseudonym key                  | passed                                 |
| events      | worktree | canonical game-event corpus tests                                    |    0 | 10 lists; 385 schemas/demo; 1,437 events; 424 deaths          | ten quarantined protocol-2100 SourceTV demos        | none                           | passed; fire/hurt absent in corpus     |
| pre-release | external | procedure in `sprint-1-playback-validation.md`                       |      | pending                                                       | UntitledParser framing plus licensed L4D2 playback  | external reference environment | does not block Sprint 3 development    |

## Decisions and risks

- Current fixtures are all SourceTV protocol 2100. Direct user commands remain unavailable even if network entity telemetry is recovered.
- Licensed L4D2 map assets and native playback are not present in this container. The tracked procedure and comparison tooling make this an explicit external gate, not an unspecified parser task.

## Prior independent audit

An independent read-only auditor reran the full workspace gate, detector benchmark, deterministic CLI double-runs, ignore/staging audit, contract audit, and Sprint 2 claim audit. After requesting a reproducible P0 oracle and reconciliation of the skip contract, both were added. The audit confirmed that the repository is safe to commit as **blocked Sprint 2 progress**, not as sprint completion. Its benchmark rerun averaged 69.63 ms per 100,000 aim samples; timing variance does not affect the functional gate.

That audit applies to revision `54f2e9b` before this recovery. A fresh read-only recovery audit is required before final handoff.

## Recovery audit

Initial verdict: **blocked**. The auditor independently reproduced the real evidence hashes and passed format, check, focused tests, build, diff, ignore, and privacy checks. It rejected completion because fire/damage/death game-event projection and userinfo-bound stable identity were still absent, playback validation accepted structurally incomplete inputs, and the lightweight CLI report contained stale capability text.

All four findings were remediated and directly tested before the final re-audit below.

Final re-audit verdict: **internal pass** with no remaining internal findings. The auditor verified bounded dynamic event projection, timed pseudonymous identity and no-time-travel behavior, strict field-specific playback schemas, honest lightweight reporting, dependency/license records, ignored raw data, and the aggregate/corpus evidence. ADR 0003 now treats the two external reference checks as pre-release validation, so Sprint 3 development is unblocked.

## Out-of-scope follow-up

- Add suitably licensed heterogeneous protocol/POV fixtures; the current corpus covers only protocol-2100 SourceTV.
- Perform selected-tick comparison with licensed L4D2 playback on compatible infrastructure after entity reconstruction works.
- Exact BSP visibility remains unavailable without versioned licensed map assets; awareness detectors skip when authoritative visibility is absent.
