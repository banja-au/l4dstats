# Licensed playback validation gate

These are the remaining external reference prerequisites before ADR 0003 permits Sprint 3 calibration. Decoder and detector tests do not substitute for independent framing validation or authentic game playback.

## Required environment

- A licensed Left 4 Dead 2 installation compatible with protocol 2100 SourceTV demos.
- The exact demo whose SHA-256 appears in `docs/sprints/sprint-1-corpus.json`.
- The matching game build and map assets, recorded with hashes or immutable build identifiers.
- An x86_64 runner capable of playing the demo and capturing authoritative entity state at selected ticks.
- UntitledParser pinned to commit `c7bd376e68cbf693071a652847eccb1d9d76eca7` on a compatible runner.

Raw demos, player names, and platform identifiers must remain outside Git. Record only pseudonymous entity epochs, numeric state, hashes, tool versions, and pass/fail differences.

## Acceptance procedure

1. Verify every demo SHA-256 and record all tool versions.
2. Run UntitledParser over all ten demos and compare header values, outer command counts/order, stop position, and malformed/truncated disposition with WitchWatch. Record its exact commit, command, output hash, and every explained branch-support difference. Any unexplained framing disagreement fails the gate; UntitledParser is not an entity-state oracle.
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

The report must include demo hashes, UntitledParser commit/results, selected ticks, redacted comparisons, tolerances, game/build/map identifiers, instrumentation version, WitchWatch revision, and final report SHA-256. Any unexplained disagreement keeps P0 blocked and becomes a focused decoder fixture.

## Why this cannot run in the current container

The development container is Linux arm64 and has neither a licensed L4D2 installation nor matching map/game assets. UntitledParser can independently check basic L4D2 framing on a compatible x86_64 runner, but explicitly does not provide the L4D2 entity-state oracle required here.
