# Sprint 4 execution

- Status: complete
- Started from revision: `8da848f`
- Current tested revision: final Sprint 4 work based on `8da848f`; all quality and exit gates pass before commit.
- Selected because: the user explicitly requested Sprint 4 after Sprint 3 passed its exit gate.
- Environment: Linux arm64 container; Node `v24.16.0`, pnpm `11.13.1`, Docker `29.1.3`; Playwright Chromium installed.
- Next action: commit the audited Sprint 4 revision and begin Sprint 5 only when requested.

## Contract

Outcome (verbatim): **a reviewer can ingest, triage, inspect, annotate, compare, and export a reproducible case locally.**

| Gate ID | Original clause (verbatim)                                                                                                                                                                                                        | Interpretation                                                                                                                                       | Verification                                                                                          | Status |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| G1      | From an allowlisted URL or local file, a reviewer reaches any finding, sees five–ten seconds of context and strongest benign explanation, compares corroborating demos, records a decision, and exports a hash-verifiable report. | One local vertical workflow must cover safe ingestion through durable review and deterministic export, with explicit counterevidence and provenance. | Playwright journeys against the real local API/worker/storage boundary plus report hash verification. | passed |
| G2      | Whole telemetry files are never sent to the browser.                                                                                                                                                                              | Browser endpoints return bounded summaries and time-window chunks only, with enforced limits.                                                        | API contract tests, payload inspection, and adversarial range requests.                               | passed |
| G3      | No action is taken against a player.                                                                                                                                                                                              | UI and API support review notes/status only; no enforcement, accusation, or automated action endpoint exists.                                        | Contract/source audit and end-to-end interaction inspection.                                          | passed |

## User-directed visual quality contract

- The workbench must be clean, distinctive, responsive, and directly L4D2-inspired without copying copyrighted game assets.
- Original cinematic key art, interface-native graphics, and restrained motion must communicate infection, telemetry, evidence, maps, and uncertainty.
- Motion must respect `prefers-reduced-motion`; interaction, focus, contrast, empty, loading, and error states must be deliberate.
- Playwright must inspect and screenshot the complete workflow at desktop and mobile sizes; issues are graded, repaired, and rechecked.

## Baseline

| Command                                  | Exit | Result/artifact                                            | Pre-existing issue                                                  |
| ---------------------------------------- | ---: | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `git status --short`                     |    0 | clean at `8da848f`                                         | none                                                                |
| `pnpm format:check` (first attempt)      |    1 | pnpm requested a non-interactive modules-directory rebuild | dependency tree created with a different pnpm/modules configuration |
| `CI=true pnpm install --frozen-lockfile` |    0 | restored 132 pinned packages; lockfile unchanged           | none                                                                |
| `pnpm format:check`                      |    0 | all matched files formatted after formatting this ledger   | none                                                                |
| `pnpm check`                             |    0 | 9/9 package tasks passed                                   | none                                                                |
| `pnpm test`                              |    0 | 14/14 tasks passed                                         | none                                                                |
| `pnpm build`                             |    0 | 9/9 production build tasks passed                          | none                                                                |

## Work log

- 2026-07-17: froze Sprint 4 and the user-directed visual quality contract before implementation.
- 2026-07-17: restored the frozen dependency tree after the recurring pnpm modules-directory mismatch and passed the full pre-change quality baseline.
- 2026-07-17: implemented the first local API/storage/worker and responsive review-workbench slices; Playwright passed 24 journeys with two expected device-scope skips.
- 2026-07-17: independent audit passed G3 and failed G1/G2: production ingestion did not persist findings, browser telemetry storage/response bounds were incomplete, and fixture-backed UI claims were not explicit enough. Sprint remains active.
- 2026-07-17: replaced the weak infected SVG hero with original, non-graphic cinematic key art informed only by genre-level references. Desktop and mobile accessibility/overflow checks pass; no Valve asset was traced or committed.
- 2026-07-17: hardened telemetry storage and delivery: 600-tick/256-KiB stored chunks, 16-chunk/512-KiB aggregate responses, tick-array clipping, and adversarial one-tick range coverage. Persistent SSE and stale-job recovery also landed; focused storage/API tests pass 11/11.
- 2026-07-17: connected local and allowlisted HTTPS/single-demo-ZIP acquisition to content-addressed storage, durable analysis/case/window persistence, cancellation, and complete report lineage. The independent audit's final G1 concern remains open while the default CLI is upgraded from metadata inspection to evidence-bundle output.
- 2026-07-17: replaced unsupported dashboard population/storage claims with API-derived counts and explicit controlled-example labels. Tick deep links request bounded server telemetry and cross-demo comparison now exposes independent windows, quality limits, persistence, and capped influence. Web type-check/build and the focused responsive browser audit pass.
- 2026-07-17: the first remediation re-audit passed G2/G3 and kept G1 failed. It proved the real-corpus worker path, but found that production case IDs were dropped by the fixture-only UI and that seeded on-screen evidence did not match the exported report. It also rejected fake cross-demo corroboration and found stale remote-ingest operations text. A versioned persisted presentation DTO and real API-backed reviewer journeys are now the active remediation.
- 2026-07-17: the exact full test matrix exposed corpus-test timeout ceilings under Turbo/Vitest contention; assertions passed, but the exit code remains red until concurrency/timeouts are made deterministic and the exact root command is rerun.
- 2026-07-17: the real-boundary Playwright journey passed against two ignored, same-match CEDAPug demos (`915419_c2m3_coaster` and `915419_c2m4_barns`). With seeding disabled, the browser queued both through the real API and worker CLI, selected a privacy-token-merged case with a genuine finding plus an independently ingested corroborating demo, loaded demo-hash-scoped bounded telemetry, persisted review status/note, and exported a digest-named report whose lineage and raw-identity redaction were asserted. The isolated SQLite/artifact directory and all child process groups were removed after the run.

## Exit-gate evidence

| Gate ID | Revision              | Exact command                                                | Exit | Evidence/artifact hash                                                | Fixture/provenance                                                                                                     | Prerequisites                                          | Result                                                                                                                      |
| ------- | --------------------- | ------------------------------------------------------------ | ---: | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| G1      | final pre-commit tree | `pnpm --filter @l4dstats/web test:e2e:real`                  |    0 | canonical downloaded report digest recomputed and matched to filename | ignored CEDAPug same-match demos `915419_c2m3_coaster` + `915419_c2m4_barns`; stable test-only HMAC key; seed disabled | Chromium, real corpus files, API/worker/CLI/SQLite/CAS | 1/1 passed; actual ingest → merged finding/corroboration → bounded playback → note/status → redacted hash-verifiable export |
| G2      | final pre-commit tree | `pnpm test`                                                  |    0 | adversarial repository/API boundary tests                             | controlled boundary fixtures plus quarantined real corpus                                                              | frozen workspace dependencies                          | 20/20 Turbo tasks passed; one-tick clipping and all tick/chunk/byte bounds pass                                             |
| G3      | final pre-commit tree | `pnpm test:e2e` plus independent contract audit              |    0 | Playwright output and audit finding                                   | controlled presentation journeys plus real-boundary journey                                                            | Chromium and local API                                 | review status/notes only; no enforcement endpoint or UI action                                                              |
| quality | final pre-commit tree | `pnpm format:check && pnpm check && pnpm test && pnpm build` |    0 | production assets 512,458/532,480 bytes                               | all workspace packages and available quarantined corpus                                                                | Node 24 and pnpm 11                                    | format passed; checks 12/12; tests 20/20; builds 12/12                                                                      |
| visual  | final pre-commit tree | `pnpm --filter @l4dstats/web test:e2e`                       |    0 | `docs/assets/workbench-overview.jpg`                                  | controlled examples visibly labeled invented                                                                           | desktop/mobile Chromium                                | 28 passed and 2 expected device-scope skips                                                                                 |

## Decisions and risks

- The visual direction will evoke L4D2 through original industrial-horror shapes, acid green/medical amber/red accents, distressed telemetry motifs, and infected silhouettes; no Valve art, maps, logos, audio, or extracted assets will be committed.
- The local workbench remains evidence review software. It will not call any player a cheater or expose enforcement controls.

## Independent audit

Final clean-room audit: **PASS** (G1 PASS, G2 PASS, G3 PASS).

- G1 independently reran the unseeded real-boundary Playwright journey. Two genuine same-match CEDAPug demos passed through the browser, guarded API, actual worker/default CLI, CAS, SQLite, keyed-HMAC association, merged presentation, demo-scoped telemetry, durable review, and canonical report export.
- The first map contributes actual ranked evidence; the associated second map remains explicitly `insufficient-data` with no manufactured score, quality, evidence, or window.
- G2 confirmed the 600-tick/256-KiB stored-window, 3,000-tick query, 16-chunk/512-KiB response, clipping, and demo-hash scope limits. Whole telemetry artifacts have no browser route.
- G3 found review status, notes, and export only. There is no accusation, publication, sanction, kick, ban, or other enforcement path.
- No blocking privacy flaw remained: raw identities and the HMAC key are never persisted; reports replace local paths with a generic origin and strip remote URL credentials, query strings, and fragments while retaining content hashes.

## Out-of-scope follow-up

- Production auth, hosted multi-user deployment, and optional licensed game-rendered clips remain Sprint 5 concerns.
