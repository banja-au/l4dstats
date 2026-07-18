# External reference validation

These comparisons are pre-release scientific validation. They do not block Sprint 3 implementation or exploratory calibration, but they are mandatory before release, moderation use, or reconstruction-accuracy claims. Decoder and detector tests do not substitute for independent framing validation or authentic game playback.

## UntitledParser framing check - no L4D2 ownership required

UntitledParser uses .NET 7 and its console project targets AnyCPU. On macOS or Linux, install a .NET 7 SDK, then run the repository helper:

```bash
./scripts/run-untitled-parser-check.sh data/sprint-1-corpus/extracted
```

With Docker Desktop, no host SDK is needed:

```bash
docker compose --profile tools run --rm reference
```

The helper pins commit `c7bd376e68cbf693071a652847eccb1d9d76eca7`, builds from source for the current machine, runs recursive demo dumps, emits WitchWatch's deterministic corpus report, and fails unless the automated comparison passes. Outputs remain untracked beneath `data/reference-validation/`. This check validates basic header/outer framing only: UntitledParser documents partial L4D2 network parsing and no L4D2 entity parsing.

### Completed framing result

On 2026-07-18, the pinned source built and ran under .NET SDK 7.0.410 on
Linux arm64. All 22 protocol-2100 SourceTV demos passed across 231,337 outer
commands. The comparison requires equal common header fields, command counts,
command order, every command tick, and final STOP position. Playback time is
compared as the exact IEEE-754 float32 value after round-tripping the
reference's shortest decimal representation. There were no missing dumps and
no unexplained differences. The privacy-safe tracked result is
`sprint-1-independent-framing.json`; raw dumps and header labels remain ignored.

## Licensed playback check - pre-release

- A licensed Left 4 Dead 2 installation compatible with protocol 2100 SourceTV demos.
- The exact demo whose SHA-256 appears in `docs/sprints/sprint-1-corpus.json`.
- The matching game build and map assets, recorded with hashes or immutable build identifiers.
- An x86_64 runner capable of playing the demo and capturing authoritative entity state at selected ticks.

Raw demos, player names, and platform identifiers must remain outside Git. Record only pseudonymous entity epochs, numeric state, hashes, tool versions, and pass/fail differences.

## Acceptance procedure

1. Verify every demo SHA-256 and record all tool versions.
2. Run UntitledParser over the complete corpus and compare header values, outer command counts/order, every command tick, and stop position with WitchWatch. Record its exact commit, command, output hash, and every explained branch-support difference. Any unexplained framing disagreement fails the gate; UntitledParser is not an entity-state oracle. This step passed for all 22 current demos on 2026-07-18.
3. Before licensed playback, record the game/build/map identifiers.
4. Select at least three ticks from each of three demos: an entity-enter tick, an ordinary delta tick, and a leave/delete or lifetime-change tick. Include survivor and infected entities where present.
5. At every selected tick, capture entity slot/lifetime, team, class, origin XYZ, eye pitch/yaw, and active weapon from licensed playback/reference instrumentation. Never substitute the spectator camera pose.
6. Export the same fields from WitchWatch for the exact demo SHA and ticks. Compare discrete values exactly; compare quantized floats at the decoded send-property resolution and document the tolerance.
7. Require zero unexplained slot/lifetime/team/class/weapon disagreements and zero position/angle disagreements outside the declared quantization tolerance.
8. Repeat the WitchWatch export and comparison. The report bytes and SHA-256 must be identical.

## Executable workflow

Create an untracked request file (for example under `data/playback/`) with the
exact ticks and revision under test:

```json
{
  "schemaVersion": 1,
  "ticks": [12345, 12360, 12410],
  "witchwatchRevision": "<git-commit>"
}
```

Export the redacted WitchWatch checkpoints. The command emits no names or raw
platform identifiers; its player epoch consists only of the demo hash, entity
slot, and network lifetime:

```bash
pnpm --filter @witchwatch/cli dev playback-export \
  ../../data/corpus/example.dem ../../data/playback/request.json \
  > data/playback/witchwatch.json
sha256sum data/playback/witchwatch.json
```

On licensed infrastructure, capture the same checkpoints and create
`reference.json` by changing `producer` to
`licensed-playback-reference` and adding `gameBuildId`, `mapAssetId`,
`instrumentationVersion`, and explicit non-negative tolerances:

```json
{
  "producer": "licensed-playback-reference",
  "gameBuildId": "<immutable-build-id>",
  "mapAssetId": "<map-hash-or-immutable-id>",
  "instrumentationVersion": "<capture-tool-version>",
  "tolerances": { "positionUnits": 0.03125, "eyeAngleDegrees": 0.01 }
}
```

Keep every other top-level field and checkpoint key from the WitchWatch export.
Replace checkpoint values with the independently captured playback values;
represent genuinely unavailable fields explicitly instead of zero-filling them.
Then compare and retain the report:

```bash
pnpm --filter @witchwatch/cli dev playback-compare \
  ../../data/playback/witchwatch.json ../../data/playback/reference.json \
  > data/playback/report.json
sha256sum data/playback/report.json
```

The comparison exits `0` only when all discrete values and availability states
agree and every numeric component is inside tolerance. It exits `2` for state
differences and `1` for invalid inputs. The report hashes both input JSON files,
records all required build/instrumentation metadata, and contains deterministic,
redacted differences. Run export and comparison twice and require identical
bytes and hashes before recording the gate as passed. `data/` remains ignored;
do not add requests, exports, references, reports, demos, or identities to Git.

The report must include demo hashes, UntitledParser commit/results, selected ticks, redacted comparisons, tolerances, game/build/map identifiers, instrumentation version, WitchWatch revision, and final report SHA-256. Any unexplained disagreement fails the pre-release gate and becomes a focused decoder fixture.

## Environment limitation

The development container has neither a licensed L4D2 installation nor matching map/game assets, so authentic playback cannot run here. UntitledParser can be source-built independently and does not require the game, but it cannot provide an L4D2 entity-state oracle.
