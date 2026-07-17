# ADR 0004: Hold Sprint 2 at the real-telemetry gate

- Status: accepted; internal decoder blocker resolved, external playback gate retained
- Date: 2026-07-17

## Context

Sprint 2 implemented its evidence contracts, geometry/context primitives, detector registry, four detector families, encounter segmentation, detector cards, benchmark, and feature explorer. Synthetic and adversarial fixtures verify the detector behavior, but ADR 0003 requires real player/entity telemetry before Sprint 2 can close.

The clean-room protocol-2100 decoder now reads all ten quarantined demos through outer framing, NET/SVC identification, server information, string tables, userinfo, instance-baseline transport, 407 send tables, 5,426 send properties, and 278 server classes. It also implements bounded field/value and packet-entity decoding behind explicit APIs.

The first real baseline oracle remains invalid under the documented Source field-index interpretation. Baseline key `261` maps both by array position and class ID to `CWorld` / `DT_WORLD`, with 63 flattened properties. Its 222-byte payload begins `03 2c 01 0c`, decodes property indexes `0, 161`, and has no valid terminator before EOF. Index 161 is impossible for that class. The algorithm and `0xfff` sentinel agree with two independent MIT implementations (`saul/demofile` and `markus-wa/demoinfocs-golang`). Exact non-stable property-priority ordering was also implemented, but cannot explain an out-of-range field index.

## Decision

Keep Sprint 2 blocked. Retain the evidence engine and bounded decoder groundwork, but do not represent synthetic detector output as real-demo validation and do not expose a probability or combined player score.

The next decoder investigation must determine whether L4D2 wraps, compresses, or otherwise transforms `instancebaseline` entry payloads, or whether the snapshot string-table extraction is wrong. It must establish a real-corpus baseline golden test before applying packet-entity deltas. After that, reconstruct player epochs and required state across the ten-demo corpus and perform the playback comparison required by ADR 0003.

## Consequences

- Evidence-engine components are usable for pure, synthetic, and future canonical inputs, with structured skips for missing prerequisites.
- Current real CEDAPug demos cannot produce detector findings or satisfy Sprint 2's reproducibility gate.
- `packages/demo-source1` entity APIs are bounded and tested but explicitly not real-corpus validated.
- Sprint 3 calibration and all probability work remain blocked.

## Recovery note (2026-07-17)

The baseline diagnosis above is historical. Recovery proved that L4D2 property streams interleave indexes and values and that non-collapsible descendants beneath collapsible tables participate in class-global flattening. All 510 populated baselines now decode, all 104,213 NET/SVC payloads traverse, and all 104,183 packet-entity frames reconstruct across the ten-demo corpus.

Canonical projection produced 932,553 player observations with complete position, team, class, and network pitch/yaw coverage; 76 human connection epochs bind to keyed pseudonyms without exposing raw identifiers. Dynamic game-event schemas decode all 1,437 corpus events and project 424 canonical death events; the corpus contains no fire or hurt messages, so those stay explicitly absent. A real detector integration also produced a byte-reproducible, conservative no-finding artifact. These results remove the internal decoder blocker but do not retroactively waive ADR 0003's licensed-playback comparison. The exact remaining procedure is recorded in `docs/sprints/sprint-1-playback-validation.md`.
