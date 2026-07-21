# ADR 0016: Treat player-POV telemetry as a perspective-scoped evidence source

- Status: accepted
- Date: 2026-07-21

## Context

L4D2 player-recorded demos use the same Source 1 demo protocol 4 and network
protocol 2100 container as the supported SourceTV corpus, but they are not the
same observation perspective. A player recording includes a `dem_usercmd`
stream for the recorder. It can also omit the recorder's authoritative player
entity from the initial packet-entity snapshot and later send a delta for that
occupied client entity without the `Enter` transition expected in SourceTV.

The command stream contains client-submitted view angles, movement values,
button state, impulse, weapon selection, mouse deltas, command number and client
tick. These are input intent from one recorder, not authoritative server
outcomes. In particular, an attack button does not prove a shot, an ammo
transition does not prove a miss, and mouse deltas are not calibrated physical
mouse movement. Player-POV event availability can also differ from SourceTV;
the inspected local corpus contains `player_hurt_concise`, but not authoritative
`weapon_fire`, `bullet_impact`, or ordinary `player_hurt` records.

## Decision

Support both SourceTV and player-POV protocol-2100 demos through the same
clean-room framing, network-message and L4D2 projection pipeline. Every artifact
records the source perspective as `source-tv`, `player-pov`, or `unknown`; it is
never inferred from a filename.

For player-POV entity recovery, an unknown delta may create an implicit entity
only when server information identifies a non-SourceTV recording, the entity
index maps to occupied `userinfo` at that tick, and the entity class resolves
uniquely to `CTerrorPlayer`. Only properties actually carried by the delta are
materialized. The recovery does not apply an instance baseline, invent a serial,
or relax unknown-entity handling for SourceTV/world entities. A later
authoritative `Enter` reconciles the implicit lifetime. Missing initial
properties remain explicitly unavailable.

Recorder commands are retained as a separate recorder-scoped stream with both
the outer demo tick and client command tick. They do not become ordinary
multi-player observations. Presentation and detector inputs maintain three
distinct evidence layers:

```text
recorder command intent -> server-observed state -> gameplay outcome
```

Any derived probable-shot model must be separately versioned and validated per
weapon and state. Until then, the product may show attack-button state and ammo
changes as weapon evidence but must show shots, hits, misses, and conventional
accuracy as unavailable. `player_hurt_concise` is projected under its own event
semantics; it must not be relabelled as the richer ordinary `player_hurt` event.

POV-only input, aim, accuracy-like, or damage-event metrics remain excluded from
the L4DStats Match Rating. They must not make player-POV and SourceTV-derived
ratings incomparable or reward the availability of a more invasive recording.

## Consequences

- The UI identifies perspective and recorder-only scope, reports command gaps
  and field availability, and retains tick deep links, limitations and strongest
  counterevidence for any POV-derived signal.
- Cross-demo detector evaluation must stratify by perspective. POV-only measures
  cannot silently populate missing SourceTV features.
- Fine-grained command and mouse-delta streams are sensitive behavioral
  telemetry. They inherit source retention/access controls and must not become
  public raw exports or cross-demo behavioral fingerprints without a separate
  privacy decision.
- Parser tests cover guarded implicit-player recovery, later reconciliation,
  slot reuse, malformed/truncated commands, SourceTV non-regression, and ignored
  real corpora for both perspectives.
- Parser, wire, contract, detector and UI versions change when their
  interpretation of perspective-scoped evidence changes.
- The native core and binding advance to `0.2.0`; parser config
  `source1-l4d2-2100-v2`, project-config version 2, and compact artifact wire
  version 2 prevent stored v1 results from being silently reinterpreted.

## Rejected alternatives

- Treating both capture forms as interchangeable loses evidence provenance and
  turns recorder-only commands into apparent observations of every player.
- Treating held attack as a fired shot manufactures precision around cooldown,
  reload, ammo, deploy, incap, prediction and weapon-specific behavior.
- Applying a default player baseline to the missing initial POV entity invents
  state that was not recorded.
- Mixing POV-only metrics into the current rating introduces capture-selection
  bias before comparability and outcome validity have been demonstrated.
