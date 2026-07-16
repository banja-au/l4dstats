# ADR 0003: Pivot to a narrow L4D2 Source 1 decoder

- Status: accepted
- Date: 2026-07-17

## Context

Ten current CEDAPug archives were safely acquired and inspected. Every demo is SourceTV with demo protocol 4 and L4D2 network protocol 2100. The current public directory spans only 2026-06-29 through 2026-07-16, so it cannot supply the initially expected year, protocol, or POV diversity.

Empirical parser spikes found:

- `saul/demofile` has useful generic concepts but its packet protocol, generated messages, entity model, and high-level projections target CS:GO. It is not an L4D2 drop-in.
- `@nekz/sdp` is smaller, MIT licensed, dependency-free at runtime, and architecturally adaptable. Its header-only mode parses an L4D2 fixture, but every message-enabled configuration tested fails at the first command. It has no L4D2 engine profile or branch tables.
- `UncraftedName/UntitledParser` independently advertises L4D2 2000–2220 basic support and documents relevant branch differences. It does not support L4D2 entity parsing. Its released Linux binary is x86_64 while this development container is arm64.
- WitchWatch's dependency-free decoder can parse the common header, but real fixtures falsified its first protocol-4 command-framing assumption. Synthetic success is insufficient.

SourceTV packet command-info angles describe the TV recorder. They are not individual player gaze. Direct per-player user commands are not present in this corpus. Player telemetry must come from networked entity state and be labeled with its actual fidelity.

## Decision

Do not adopt `demofile` or `@nekz/sdp` as the engine. Continue a narrowly scoped, clean-room L4D2 decoder behind the existing CLI/contract boundary, using permissively licensed projects and public SDK headers only as behavioral references. Do not copy Source SDK implementation code.

Implement and validate in this order:

1. Correct protocol-4 outer framing across all ten fixtures, including full traversal to Stop, bounded opaque payloads, unknown-command reporting, and deterministic output.
2. Implement a bounded bit reader and L4D2 protocol-2100 NET/SVC registry. Unknown IDs remain counted with tick and payload context.
3. Decode server/send tables, class baselines, string tables, `userinfo`, and dynamic game-event schemas.
4. Reconstruct entity lifetimes/deltas and project only the L4D2 fields required by canonical observations: stable player epochs, positions, networked eye angles, teams/classes, weapons, and fire/damage/death events.
5. Validate header/outer commands against UntitledParser on a compatible runner and selected player-state ticks against licensed L4D2 playback on compatible x86_64 infrastructure.

Each phase retains strict byte/allocation/command limits, corruption tests, real-corpus golden manifests, protocol coverage, and byte-deterministic reports.

## Consequences

- Sprint 2 and all scoring work are blocked until the Sprint 1 telemetry gates pass on a suitably heterogeneous corpus.
- The current ten-demo corpus can validate protocol-2100 SourceTV behavior only. Older protocols and POV demos require separately authorized fixtures.
- Direct input/aim claims are unavailable for SourceTV. Networked eye angles, if decoded, must be described as server-observed and potentially quantized/interpolated.
- `@nekz/sdp` remains a useful design/reference candidate, not a runtime dependency.
- Authentic player-state comparison requires external licensed infrastructure and cannot be replaced by TV-camera agreement.
