# Sprint 1 execution

- Status: complete - feasibility failed at the entity layer and the declared narrow-decoder pivot was approved
- Started from revision: `810230c`
- Current tested revision: `810230c` plus this uncommitted Sprint 1 diff
- Selected because: explicitly requested; no prior Sprint 1 report existed
- Environment: Ubuntu 24.04 arm64; Node `v24.16.0`; pnpm `11.13.1`; no L4D2 installation or compatible playback tool
- Next action: do not begin Sprint 2; execute ADR 0003 phases 2–5 until the player-telemetry gate can be rerun

## Outcome

Contract (verbatim): **deterministically turn heterogeneous CEDAPug archives into validated player/tick observations, or make a documented parser pivot.**

The telemetry path failed honestly and triggered the second outcome. WitchWatch now safely acquires archives, deterministically frames current L4D2 demos, reports telemetry availability, and has an approved narrow-decoder plan. It does not claim to recover player telemetry and blocks scoring.

## Exit-gate matrix

| Gate | Original clause (verbatim)                                                             | Result                                                                                  | Evidence                                                       |
| ---- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| G1   | All ten demos recover stable player epochs                                             | Failed: `userinfo`/entities remain opaque                                               | Coverage report marks identity unavailable                     |
| G2   | core events                                                                            | Failed: event schemas remain opaque                                                     | Coverage report marks events unavailable                       |
| G3   | positions                                                                              | Failed: entity deltas remain opaque                                                     | Coverage report marks positions unavailable                    |
| G4   | eye angles                                                                             | Failed: TV camera angles are not player gaze                                            | Coverage report and ADR 0003                                   |
| G5   | weapon/fire events with explicit availability                                          | Failed, explicitly unavailable and never zero-filled                                    | Coverage report                                                |
| G6   | selected ticks agree with playback                                                     | Unverified: licensed compatible playback absent; independent parser lacks L4D2 entities | ADR 0003                                                       |
| G7   | reruns are byte-deterministic                                                          | Passed for implemented outer-framing report                                             | Double-run SHA-256 below                                       |
| G8   | malformed inputs stay within limits                                                    | Passed                                                                                  | Acquisition and decoder suites                                 |
| G9   | unknown protocol content is reported                                                   | Failed at NET/SVC layer; outer commands are covered                                     | Coverage report                                                |
| G10  | If view angles/user commands are unavailable for a demo type, document the scope limit | Passed                                                                                  | All fixtures classified SourceTV; report/ADR document fidelity |
| G11  | If the gate fails, scoring work is blocked and a narrow decoder plan is approved       | Passed                                                                                  | Accepted ADR 0003; no detector/scoring package                 |

## Baseline

The initial tracked tree was clean. Pnpm first required a non-interactive `node_modules` relink after Corepack state changed; `CI=true pnpm install --frozen-lockfile` repaired it without lock changes.

| Command             | Exit | Result                                           | Pre-existing issue        |
| ------------------- | ---: | ------------------------------------------------ | ------------------------- |
| `pnpm format:check` |    1 | Only this newly created ledger needed formatting | none in the original tree |
| `pnpm check`        |    0 | Passed                                           | none                      |
| `pnpm test`         |    0 | Passed                                           | none                      |
| `pnpm build`        |    0 | Passed                                           | none                      |

## Work delivered

- `packages/acquisition`: streamed Apache discovery; exact-host HTTPS policy; redirect revalidation; bounded/cancellable download; SHA-256 content addressing; atomic restart/dedup; provenance manifests; safe bounded ZIP parsing/extraction.
- `packages/demo-source1`: dependency-free bounded reader, header and L4D2 protocol-4 outer commands, opaque payloads, structured failures, corpus golden test.
- `packages/contracts` and `packages/l4d2-schema`: versioned canonical observations, explicit availability, and slot-reuse-safe player epochs.
- `apps/cli`: deterministic `inspect` and `corpus` reports that refuse to manufacture player telemetry.
- Corpus and protocol manifests, third-party inventory, README updates, and ADR 0003.

## Corpus and empirical findings

Ten ignored CEDAPug fixtures total 91,468,097 DEM bytes. The public index contained 63,257 ZIP rows but covered only 2026-06-29 through 2026-07-16. Every sample is SourceTV, demo protocol 4, network protocol 2100; intended year/protocol/POV heterogeneity is unavailable from the current index.

Real fixtures falsified the initial generic protocol-4 framing model. L4D2 uses four 76-byte split-screen command-info blocks and a tick-only Stop command without a slot. Correcting those branch rules produced exact EOF traversal for all ten demos: 104,253 frames, 104,183 packets, no outer issues, and one Stop per demo.

`demofile` was rejected as CS:GO-specific. `@nekz/sdp` parsed a real header but failed deterministically when message parsing began. UntitledParser supports basic L4D2 framing but not entities. Its published Linux binary is x86_64, but its AnyCPU source later built and ran successfully on Linux arm64.

## Reproducible evidence

| Gate              | Exact command                                                                                                                           | Exit | Evidence/fixture                                                                                              | Result                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| G1–G5, G9         | `pnpm --filter @witchwatch/cli dev corpus /workspace/data/sprint-1-corpus/extracted`                                                    |    0 | `sprint-1-protocol-coverage.json`, SHA-256 `01fd1d27a6f7bb4c298905ac9ca5ffd7b910d66d946491734cabb3b1d468e0dc` | Required player telemetry explicitly unavailable         |
| G6                | `@nekz/sdp` real-fixture smoke plus UntitledParser capability inspection                                                                |  n/a | ADR 0003; DEM `370f61da…`                                                                                     | No equivalent player-state reference; remains unverified |
| G7                | Run the exact corpus CLI twice directly, then `cmp docs/sprints/sprint-1-protocol-coverage.json /tmp/sprint-1-protocol-coverage-2.json` |    0 | Both SHA-256 `01fd1d27a…`; no timing/sensitive/local fields                                                   | Byte-identical                                           |
| G8                | `pnpm test`                                                                                                                             |    0 | Synthetic hostile cases plus hashes in `sprint-1-corpus.json`                                                 | 33 tests passed: acquisition 13, decoder 14, other 6     |
| G10               | `jq '.demos[].telemetryAvailability' docs/sprints/sprint-1-protocol-coverage.json`                                                      |    0 | Ten SourceTV fixtures                                                                                         | Scope explicit                                           |
| G11               | Review ADR 0003 and assert no detector/scoring package exists                                                                           |    0 | Empirical failures above                                                                                      | Pivot approved; scoring blocked                          |
| Implemented scope | `pnpm format:check && pnpm check && pnpm test && pnpm build`                                                                            |    0 | Six packages; real corpus present                                                                             | Passed                                                   |

Raw ZIP/DEM files remain ignored under `data/`. The tracked corpus manifest contains hashes and minimized headers, not player/server identities. The complete provenance and retention statement is in `sprint-1-corpus.json`.

## Decisions and risks

- ADR 0003 approves a clean-room narrow L4D2 decoder in phases: outer framing; NET/SVC bitstream; send/string/event tables; entities/projection; independent playback validation.
- SourceTV has no direct per-player user commands. Networked eye angles, if later decoded, are server-observed and potentially quantized/interpolated.
- The acquisition layer deliberately atomically restarts partial downloads rather than claiming range resume.
- ZIP64/multi-disk archives fail closed; extraction is bounded and never trusts archive paths.
- Current fixtures establish only current protocol-2100 SourceTV outer framing.

## Independent audit

The fresh audit initially failed G7 after proving two exact CLI runs differed because wall-clock timings were embedded. The defect was fixed rather than waived: canonical reports no longer contain timing, sensitive recorder/server names, or absolute local paths. A regression test covers those exclusions, and two direct reruns now hash identically at `01fd1d27a…`.

The read-only re-audit independently reproduced that hash, verified formatting and the diff, and issued **PASS for Sprint 1's explicitly permitted documented-parser-pivot outcome**. It kept G1–G5 and G9 failed and G6 unverified; it confirmed G7, G8, G10, and G11 pass, the pivot is approved, and scoring remains blocked. No blocking defects remain.

## Out-of-scope follow-up

- Continue Sprint 1 feasibility through NET/SVC messages, tables, event schemas, entities, and projection before Sprint 2.
- Obtain authorized older-protocol and POV fixtures.
- Licensed L4D2 playback with matching game/map assets remains required for independent selected-tick entity validation. The separate UntitledParser framing gate passed across 22 demos and 231,337 commands on Linux arm64 on 2026-07-18.

Recovery note: later Sprint 2 work completed and independently audited the real-corpus decoder, entity, identity, event, and deterministic-evidence gates. ADR 0003 now permits Sprint 3 development while retaining external comparison as pre-release validation.
