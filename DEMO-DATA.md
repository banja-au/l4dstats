# Demo data contract

## Source containers and hashes

Hosted input may be a raw `.dem` or one explicitly supported single-demo
compressed container. The uploaded object and expanded demo have separate
SHA-256 and byte-size provenance. Parser, statistics and detector lineage always
key the canonical demo to the expanded `.dem` bytes; the uploaded-object hash is
retained as acquisition lineage. Compression never changes field availability,
and a missing or rejected expansion is never represented as a zero-valued demo.
Operator backfills preserve the same two hashes while retaining source bytes
only in ignored local storage. Their hosted source lineage is explicitly marked
`local-backfill`; it must not imply that a raw source exists in hosted object
storage. Source listing timestamps, filenames and game identifiers are
acquisition provenance and scheduling hints, not demo-internal game identity.
For the settled operator backfill in ADR 0014, an adapter's provider-issued
source game key is retained as a separate external association. It may group
multiple recordings of one chapter only after every currently cataloged member
has processed and embedded campaign evidence does not conflict. The resulting
game remains explicit about `external-source-group` evidence; the key is never
reported as a demo-extracted universal match UUID, and a quiet source window is
not proof that gameplay reached a planned finale. Selection additionally waits
for standard filename evidence of map 3, or three distinct map names for a
custom campaign. This adapter metadata is only an ingestion maturity gate; it
does not replace demo-extracted chapter evidence or prove earlier maps exist.

This is the source of truth for what L4DStats extracts from L4D2 SourceTV and
player-POV `.dem` files. Update it in the same change as any decoder, projection, artifact,
or statistic change. Never present an unavailable value as zero.

## Supported input

- Source 1 demo protocol `4`, L4D2 network protocol `2100`.
- SourceTV and player-POV demos. The recording perspective is retained as
  `source-tv`, `player-pov`, or explicitly `unknown`; perspective-specific
  telemetry is never generalized to players who were not the recorder.
- In the proposed hosted deployment, a successfully parsed source demo is
  deleted after its derived artifacts and lineage are durably verified. The
  SHA-256, source metadata, byte size, parser/config/build versions, map lineage
  and explicit availability remain. A stored report can still be inspected and
  hash-verified, but parser reanalysis requires the user to upload bytes matching
  the recorded source hash. Source deletion must be displayed explicitly and
  must never be presented as full source reproducibility.
- `userinfo` identity is correlated by effective tick and entity slot. Player
  names and decimal SteamID64 values are retained in the local analysis
  artifact for display and Steam profile links. Steam IDs also become keyed
  stable tokens for safe cross-demo joins; join logic never relies on names.
  The networked fake-player flag distinguishes bots from human identities.
  If an early entity epoch predates its `userinfo` row, the epoch inherits a
  later identity only when that entity slot exposes exactly one distinct human
  identity across the entire demo (`unique-slot-v1`). Ambiguous slot reuse stays
  anonymous, and the artifact marks whether identity was observed or inferred.

## Parser artifact and lineage

Normal evidence analysis uses the clean-room Rust parser through one coarse,
bytes-only Node-API call. It is the repository's only demo parser; failures are
reported explicitly and never select a fallback implementation. Rust emits
compact artifact wire version 3, a private
transport into the shared TypeScript statistics, detector and evidence packaging
path rather than a second public data contract.

Wire v3 keeps every projected observation tick but losslessly delta-encodes the
large L4D2 state tuple within each player epoch: a `null` row entry means
“identical to the preceding state for this epoch,” never unavailable or zero.
The first row in an epoch must carry a complete tuple, and the strict adapter
rejects an inheritance marker before that definition. Position, eye angles,
team, class, weapon, demo time and provenance remain present per observation.
This removes repeated counter/loadout/state serialization without sampling the
timeline. On the 69,961,475-byte player-POV validation demo, all 702,874
observations are retained while the private artifact is 145,231,187 bytes,
below the unchanged 256 MiB output limit; the final evidence result is 5.9 MiB.

The adapter independently verifies input byte length and demo SHA-256 and
strictly validates bounded registries, rows, masks, nested events, match state,
coverage, missingness and provenance before rehydration. Tick remains primary.
Null, unavailable and unobserved values retain their exact meaning; compact
encoding must never turn them into zero.

Lineage records native core and binding versions, parser config ID,
binding/config/wire versions and the 64-hex native build SHA-256. Production
rejects an unstamped all-zero build hash. Changes to parser semantics, compact
wire interpretation, parser configuration or downstream derivation require new
versions and reanalysis of incompatible stored results. Existing results are
preserved rather than silently reinterpreted. Before the TypeScript parser was
removed, exact 22-demo semantic parity to its prepared-projection output was
recorded as migration evidence. That historical comparison does not replace the
still-open licensed game-playback validation boundary.

## Protocol-2100 decoding reference

This section documents the bounded format implemented by this repository so an
independent parser author can reproduce the same evidence boundary. It is not a
claim that every Source-engine branch uses this layout. Multibyte byte-aligned
scalars below are little-endian unless stated otherwise; packet-message and
entity payloads are bit streams whose field widths come from the protocol and
dynamic send tables.

### Fixed header

The protocol-4 header is 1,072 bytes:

| Offset | Bytes | Field                                                |
| -----: | ----: | ---------------------------------------------------- |
|      0 |     8 | NUL-padded Latin-1 stamp, expected `HL2DEMO`         |
|      8 |     4 | signed demo protocol, supported value `4`            |
|     12 |     4 | signed network protocol, supported L4D2 value `2100` |
|     16 |   260 | server name                                          |
|    276 |   260 | recorder/client name                                 |
|    536 |   260 | map name                                             |
|    796 |   260 | game directory                                       |
|   1056 |     4 | finite, nonnegative playback time as `float32`       |
|   1060 |     4 | nonnegative signed playback ticks                    |
|   1064 |     4 | nonnegative signed playback frames                   |
|   1068 |     4 | nonnegative signed sign-on length                    |

Fixed strings terminate at the first NUL and are not trusted identifiers.
Playback metadata is summary metadata, not an authoritative continuous clock.

### Outer command framing

After the header, protocol-4 commands normally begin with one byte command,
signed 32-bit demo tick, and one byte player slot. Known command IDs are:

|  ID | Command         | Body after tick/slot                                                                   |
| --: | --------------- | -------------------------------------------------------------------------------------- |
|   1 | sign-on         | four command-info records, inbound/outbound sequences, length-prefixed network payload |
|   2 | packet          | same body as sign-on                                                                   |
|   3 | sync tick       | no body                                                                                |
|   4 | console command | signed 32-bit byte length and payload                                                  |
|   5 | user command    | signed 32-bit outgoing sequence, then signed 32-bit byte length and payload            |
|   6 | data tables     | signed 32-bit byte length and payload                                                  |
|   7 | stop            | terminal command; this decoder accepts an optional signed tick but no slot/body        |
|   8 | custom data     | signed 32-bit callback ID, then signed 32-bit byte length and payload                  |
|   9 | string tables   | signed 32-bit byte length and payload                                                  |

Each command-info record is a signed flags word followed by six three-float
vectors: view origin, view angles, local view angles, then their secondary
variants. A parser must bounds-check every signed length before conversion,
stop if an unknown command makes subsequent framing ambiguous, and distinguish
clean `stop`, truncation, and trailing bytes. Current defaults cap a demo at
512 MiB, ten million outer commands, and 64 MiB per outer payload.

If a valid header and at least one complete command have been decoded, an EOF
inside the final command is recoverable. The decoder discards only that
incomplete command, emits `TRUNCATED_TAIL` at its starting byte, consumes the
full input, and records `stopped=false`. Header truncation, invalid signed
lengths, oversized payloads, and corruption that is not an EOF shortage remain
fatal. Consequently every field after the last complete command is unavailable;
it must not be inferred from header playback totals or rendered as zero.

### Clocks and packet messages

At least three coordinates can coexist:

- outer demo command tick, used as L4DStats' canonical deep-link coordinate;
- `svc_Tick` engine tick inside a packet; and
- POV user-command `tick_count`.

They are retained separately. Do not calculate one by assuming the other is
continuous: pause, restart, skip, choke/loss and recording boundaries can
create gaps or repeated values. Derived demo seconds use the finite positive
`svc_ServerInfo` tick interval with explicit availability.

Sign-on and packet payloads contain a sequence of bit-packed net messages. For
the protocol-2100 projection, `svc_ServerInfo` supplies network protocol,
server generation, `is_source_tv`, class/client counts and tick interval.
That decoded flag—not header recorder name or filename—selects `source-tv`
versus `player-pov`; missing server info produces `unknown`. Message IDs and
schemas are branch-specific and parsing is bounded before nested payload bits
are visited.

### Sign-on state, schemas and identity

The data-table snapshot describes send tables and server classes dynamically.
The parser flattens inherited/excluded properties into class-specific schemas;
property order, flags and bit encodings must come from that snapshot rather
than a hard-coded C++ struct. The string-table snapshot supplies
`instancebaseline` class baselines and `userinfo`. Later string-table updates
are applied at their effective demo tick so an entity index/user ID/slot is
never treated as a permanent human identity. Protocol-2100 `userinfo` XUID is
network-byte-order even though adjacent scalar fields are little-endian.

`svc_PacketEntities` carries `max_entries` (11 bits), a delta flag and optional
32-bit `delta_from` engine sequence, one-bit baseline slot, updated-entry count
(11 bits), nested data length (20 bits), update-baseline flag, and that many
nested bits. A full snapshot starts without a prior frame. A delta must be
applied to the referenced engine snapshot, not simply the most recently seen
packet. The implementation retains a bounded 128-snapshot history to tolerate
longer acknowledged-reference gaps; a missing referenced frame is a quality
failure, never permission to substitute empty state.

Entity updates encode leave/delete, enter with class and serial, or delta of an
existing lifetime. Instance baselines apply on authoritative entry. Entity
indices are reusable, so class, serial, `userinfo`, connection epoch and tick
are all part of reconstruction provenance.

Player POV has one empirically verified lifecycle exception. Its initial full
snapshot can omit an occupied local `CTerrorPlayer`, then send a delta for that
entity without `Enter`. Recovery is allowed only when `is_source_tv` is false,
effective `userinfo` occupies that entity index, and exactly one server class
is `CTerrorPlayer`. The implicit lifetime applies only properties present in
the delta—no instance baseline or invented serial—and a later authoritative
entry reconciles it. SourceTV, ambiguous identity/class and non-player unknown
entities continue to fail closed.

### Player-POV `dem_usercmd`

For the inspected L4D2 protocol-2100 player recordings, the outer outgoing
sequence equals the decoded command number and is checked as an integrity
invariant. The inner payload is a bitwise delta from zero in this order:

1. changed flag, then optional signed 32-bit `command_number`;
2. changed flag, then optional signed 32-bit `tick_count`;
3. three changed flags, each followed by an optional finite `float32` view angle;
4. changed flags and optional finite `float32` forward, side and up movement;
5. presence flag and optional 32-bit buttons mask;
6. presence flag and optional 8-bit impulse;
7. presence flag and optional 11-bit weapon selection, followed by a subtype
   presence flag and optional 6-bit subtype;
8. changed flag and optional signed 16-bit mouse X delta;
9. changed flag and optional signed 16-bit mouse Y delta.

Absent delta fields decode to zero for that command because the recorder writes
these payloads against the zero command baseline; this is protocol decoding,
not imputation of an unavailable observation. Remaining high padding bits in
the last byte must be zero. The implementation caps each inner payload at 1,024
bytes and records malformed commands and sequence gaps separately from decoded
commands. Unused high bits in the final source byte are padding rather than
telemetry; their values are excluded. A further whole trailing byte is rejected.

These fields describe only the recording client's submitted command. Button
bits are held state, not action counts. The command may be rejected or unable
to act because of cooldown, reload, empty ammunition, deploy delay, incap/pin,
pause, prediction correction or weapon-specific rules. Automatic weapons,
shotgun pellets, melee, chainsaw, throwables, mounted weapons and infected
abilities also prevent a universal command-to-shot conversion.

### Events and perspective differences

Game-event schemas arrive dynamically in `svc_GameEventList`; event payloads
must be interpreted through the matching schema, not a global assumed layout.
The inspected SourceTV corpus is event-sparse. The inspected player-POV corpus
adds `player_hurt_concise` (victim user ID, attacker entity index, health damage
and damage-type mask) but has no authoritative `weapon_fire`, `bullet_impact`,
or ordinary rich `player_hurt`. Attacker entity is resolved at the event tick
and may remain ambiguous after reuse. Concise hurt does not contain weapon, hit
group, impact position, fired-shot count or a denominator covering common
infected and world misses.

Corpus observations are availability evidence, not protocol guarantees. Every
consumer must inspect per-demo schemas and coverage and keep unavailable fields
unavailable.

## Directly decoded data

| Source                                   | Retained data                                                                                                                                                                                                                                                  | Limits                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo header                              | map, playback time/ticks, byte size, protocols                                                                                                                                                                                                                 | Header time can include non-play time.                                                                                                                                                                                                                                          |
| Demo framing                             | command kind/tick, packets, sign-on, data/string tables                                                                                                                                                                                                        | Corrupt or ambiguous framing fails closed.                                                                                                                                                                                                                                      |
| POV `dem_usercmd`                        | recorder command number and client tick, view angles, intended movement, buttons, impulse, requested weapon/subtype when present, and command-generation mouse deltas                                                                                          | Recorder-only client command intent. It does not prove a shot, achieved movement, a hit, physical raw mouse motion, recoil compensation, or the rendered crosshair. SourceTV has no per-player commands.                                                                        |
| `svc_Tick`                               | engine tick                                                                                                                                                                                                                                                    | Demo and engine ticks are distinct clocks.                                                                                                                                                                                                                                      |
| Data tables, baselines, `PacketEntities` | bounded entity snapshots/deltas                                                                                                                                                                                                                                | Only networked send properties exist.                                                                                                                                                                                                                                           |
| `CTerrorPlayer`                          | position, eye angles, team, named L4D2 class, weapon, health/temp health, life/incap/ghost state, Versus team, Tank frustration, pin relationships, checkpoint total infected kills/revives/incaps/SI incaps/pounces/highest pounce damage/longest Jockey ride | SourceTV omits user-command buttons. Counters can reset at round/team transitions.                                                                                                                                                                                              |
| `CTerrorPlayerResource`                  | player-indexed primary weapon, first-aid slot, temporary-health slot, health/max-health arrays and round setup time                                                                                                                                            | Slot values are networked L4D2 weapon IDs. Possession changes do not prove use, transfer source, shots, hits, or intent.                                                                                                                                                        |
| `Witch`                                  | entity lifetime, cell-relative origin, rage, wander rage, and burning state                                                                                                                                                                                    | The inspected entity snapshots omit the cell state needed to normalize the Witch origin into world coordinates. Witch health, attacker, startler, and damage attribution are also absent.                                                                                       |
| `CTerrorGameRulesProxy`                  | campaign/chapter/Survivor scores, per-Survivor Versus/death distance, round duration/number, team flip and second-half state                                                                                                                                   | Team labels remain neutral until roster-to-score attribution is externally validated.                                                                                                                                                                                           |
| `userinfo`                               | entity mapping, normalized protocol-2100 user ID, player name, decimal SteamID64, privacy-safe stable token                                                                                                                                                    | XUID uses network byte order while adjacent scalars are little-endian; human IDs are corpus-validated against the Steam individual-account shape. Names are untrusted display text and can change or collide. Slot reuse is epoch-scoped; malformed identity stays unavailable. |
| `svc_GameEventList`/`svc_GameEvent`      | every event schema/payload actually sent                                                                                                                                                                                                                       | Inspected CEDAPug SourceTV commonly sends only deaths, team/disconnect, round boundaries, and HLTV status. Never assume other events exist.                                                                                                                                     |
| `player_death`                           | user IDs, weapon, headshot, bot flags, infected victim class, death position                                                                                                                                                                                   | It does not provide damage, assists, hits, or shots. An empty victim name commonly denotes a Survivor death.                                                                                                                                                                    |
| `player_hurt_concise`                    | victim user ID, attacker entity index, health damage, and damage-type mask when the event schema supplies them                                                                                                                                                 | Attacker entity index is resolved against entity/identity state at that tick and can remain unavailable. The event omits weapon, hit group, impact point, and an authoritative fired-shot record.                                                                               |

## Derived artifact statistics

- Game/session evidence: an HMAC-protected embedded server identity,
  privacy-safe stable-human-roster token, Source server generation counter,
  campaign code, and chapter ordinal. Official names use `c<number>m<number>`.
  Custom names with an embedded prefix and ordinal, such as `hf04_escape`, use
  the namespaced campaign `custom:hf` and chapter `4`, with
  `custom-campaign-map-sequence-v1` provenance. L4D2 demos do not expose a
  universal match UUID. Exact roster hashes remain the primary continuity
  evidence. A changed roster may join only when the protected server and
  campaign agree, both chapter and server generation are exactly adjacent, and
  at least four stable identities and 75% of the smaller roster overlap. This
  accommodates substitutions and spectators while keeping rematches with a
  repeated chapter/generation separate. Filenames are never used for grouping.

- Demo: duration, tick rate, perspective, observation/event counts, decode
  issues, field availability, and recorder-command decoding/gap coverage.
- Player POV command evidence: recorder-scoped command states, press/release
  edges, hold durations, intended movement, command view angles, and mouse
  deltas. Product surfaces separate these from server-observed state and
  outcomes. Attack-button state is never renamed to shot or accuracy.
- Participation: known fake-player identities are excluded before competitive
  player statistics, traces, ratings, and player counts are derived. Human
  identities never observed on Survivor or Infected are emitted separately as
  spectators for display and remain excluded from those calculations. A human
  who actually occupies a competitive side remains a participant, including a
  substitute. Participation otherwise includes alias, Survivor/Infected side participation, observed SI
  classes, dominant team/class, observed duration, distance,
  view-angle travel, weapon set, and sample coverage.
- Survivor: deaths, checkpoint total infected kills, revives, incaps, and observed
  health loss; medkit/pills/adrenaline/throwable/defib use, damage taken,
  first-aid sharing, Tank/Witch damage, headshots, and melee kills. Raw mission
  and checkpoint accuracy properties remain hidden because they do not expose
  shots fired or hits, and their semantics and reset behavior have not been
  validated against a reference.
- `m_checkpointSurvivorDamage` is a misleading engine name for damage a player
  dealt while controlling Infected. Real-corpus class-counter reconciliation
  confirms this direction. It is never presented or rated as Survivor damage
  dealt to SI.
- Survivor health traces: per-player permanent health, maximum health, raw
  temporary-health buffer, incap state, life state, tick, and derived time are
  retained at material state changes and at most once per elapsed second.
  These are sampled state traces. They can miss intermediate changes, do not
  calculate effective temporary health, and cannot attribute damage to an
  attacker.
- Survivor loadout traces: player-resource primary weapon, first-aid and
  temporary-health slots are retained at each material change with per-field
  coverage. ID zero is an observed empty slot, not missing data. Weapon names
  follow the Left4DHooks L4D2 weapon-ID table and were cross-checked against
  reconstructed active weapon classes across all local demos. Loadout changes
  prove sampled possession changed, not that an item was used or supplied by a
  particular player.
- Survivor active-ammo traces: sampled active weapon entity class, clip,
  player ammo-array reserve, reload flag, extra primary ammo and upgraded ammo
  loaded. The artifact compresses ordinary state to at most one point per
  second while preserving weapon, ammo-type and reload transitions. Clip and
  reserve changes do not prove a shot, hit, miss or accuracy value because
  weapon swaps, reloads and dropped weapons also change the observed state.
- Infected: deaths, Survivor kills, SI incaps, pounces, highest pounce damage,
  longest Smoker/Jockey control, Charger victims, Tank punches/throws, pulls,
  hangs, booms, active pin time, ghost time, and networked damage counters.
- Combat: SI kills by class, kills by weapon, headshots, Tank/Witch deaths, and
  Survivor/SI death totals.
- Versus state: campaign/chapter score, Survivor score/distance, round
  duration/number, side flip, and half state. Every changed game-rules state is
  retained with its demo tick to form the score-progression series. Some
  CEDAPug SourceTV files end after one side commits its chapter score. For a
  sequence of adjacent maps, the next map's opening cumulative state confirms
  the previous map's missing side. When a terminal demo contains both round-end
  events, the maximum live `m_iSurvivorScore` for each score index is added to
  the opening campaign score. This recovers a completed second-side chapter
  score that SourceTV can retain before `m_iCampaignScore` commits it. A final
  map remains incomplete when neither boundary is present. Confirmation is
  calculated on the canonical adjacent chapter sequence before user map
  filters are applied, so a skipped chapter cannot be misattributed.
- Timeline: round boundaries, team changes, SI spawns, pins, Survivor incaps,
  revives, Tank control, selected positive SI checkpoint-counter increments,
  and deaths with demo tick, derived time, pseudonymous participants and
  connection-epoch player IDs,
  weapon/class, headshot, and position. A clear is emitted only when a pin ends
  within 0.5 seconds of a death event naming the pinning SI and its killer.
- Competitive structure: neutral first/second-half tick ranges are split only
  at an observed game-rules second-half transition. Per-half Survivor/Infected
  state is labelled unknown when no half flag is observed. Per-half membership
  uses the dominant observed competitive team within that half to
  avoid transient cached pre-swap state; it is not a validated mapping of
  roster names to score indices. Per-player counter output sums positive
  observed deltas inside a half and treats decreases as resets, so a reset is
  never counted as negative output. Each half-player row also retains the set
  of counters actually observed, allowing the UI to distinguish an observed
  zero from unavailable telemetry. It now also retains a half-bounded summary
  of sampled movement/view travel, field coverage, weapon/class presence,
  health loss, pin/ghost time, total infected kills and scalar checkpoint deltas, plus
  death-event kills/deaths/headshots. This is what makes round selection
  recompute player, combat, timeline and coverage views without relabelling
  whole-demo totals as half totals. A late first observation can still make
  any delta a lower bound.
- Observed opening area: each newly derived competitive half records either a
  bounded `survivor-opening-area-v1` result or an explicit unavailable reason.
  The derivation requires an observed `round_start`, a positive tick duration,
  and at least two resolved Survivors with finite observed positions during the
  inclusive eight-second post-start window. It retains the earliest eligible
  upright observation per player, the player/tick/position samples, centroid,
  XYZ bounds, maximum planar radius, and limitations. Missing team, position,
  or tick duration is never substituted with zero. The result describes the
  first observed round opening only: it is demo-derived, is not an authored
  saferoom/checkpoint, does not prove players remained in the area, and may be
  unavailable for late recordings or sparse telemetry. Older artifacts omit
  this append-compatible field.
- Indexed match-state arrays preserve an absent network send property as
  `null`; numeric zero is reserved for an observed engine value. Consumers
  must not reconstruct or chart a score boundary whose required team index is
  missing.
- `m_checkpointZombieKills` is a total infected-kill counter, not a Common
  Infected counter. A fresh complete CEDAPug game showed its excess over the
  plugin's `GunStats.all.CommonKill` exactly equalled attributed SI kills for
  six of eight players; the remaining two retained additional unexplained
  boundary residuals. It is therefore presented only as checkpoint total
  infected kills and is excluded from the rating. Common kills cannot be
  recovered by subtracting SourceTV SI death events because that attribution is
  incomplete for some players.
  Competitive derivation v5 renames the persisted field to
  `checkpointInfectedKills`; v1 through v4 artifacts require reanalysis before
  this value or a rating is presented as current.
- Neutral rosters: `side-swap-v1` assigns Roster A from the earliest observed
  Survivor side and Roster B from the opposing side, then unions the inverse
  side in the second half. A complete four-player swap is high confidence;
  partial, single-half, reconnect, and substitute evidence remains
  provisional. These labels do not claim a mapping to engine score indices.
- SI lives and hits: an observed non-ghost infected class interval forms an SI
  life, with spawn/already-active/Tank-control and death/ghost/class-change/demo
  boundaries kept explicit. Controls, sampled pin duration, and positive
  counter deltas are attached to that life. In competitive derivation v2,
  non-Tank lives are grouped only when each observed start falls within eight
  seconds of the cluster's first spawn. This prevents transitive spawn chains
  from creating multi-minute hits. The cluster window ends at the earlier of
  the last grouped life ending or eight seconds after the final grouped spawn.
  Competitive derivation v6 measures each Survivor's maximum permanent-health
  drawdown within a contiguous sequence of distinct-tick samples no more than
  0.25 seconds apart, then sums those four player bounds. Health is validated
  in the 0 to 100 range, so the team result cannot exceed 400 HP. Healing and
  repeated state oscillation are not counted twice. Samples must be alive and
  upright inside the bounded launch window.
  Incapacitation-pool health, dead states, transitions into or out of incap,
  and duplicate same-tick state updates are excluded. Derivation v4 incorrectly
  summed every decrease, so healing or state oscillation could count the same
  health twice. Derivation v2 bounded the
  window but incorrectly included the 300-point incap pool; its HP must not be
  used. Distinct cluster windows are clipped at the next cluster boundary so a
  health transition cannot contribute to two hits. V4 made the bounded window
  a persisted-version guarantee and rejected a missing or invalid tick
  interval, but its gross-decrease calculation is superseded by v6. The v6
  value is a sampled maximum drawdown, not SI-attributed damage. It can miss
  temporary-health loss and can include common infected, friendly fire, fire,
  falls, Witch, Tank, or other damage inside the same short window. Derivation
  v1 also used the longest grouped life as the end boundary. V1 through v5 must
  be reanalyzed before cluster HP is displayed.
- Clear summaries: only the narrow death-correlated clears above are counted.
  Response time is derived from the matching pin start to that clear tick;
  duplicate carry/pummel endings credited to the same clearer and victim at one
  tick collapse into one summary clear. Shove, tongue-break, displacement, and
  otherwise unobserved clears are not
  included.
- Tank encounters: contiguous observed Tank-control intervals retain controller,
  ticks, sampled health/frustration extrema, checkpoint punch/registered-throw
  deltas, and observed Survivor incaps/deaths inside the interval. Positive
  `m_checkpointPZTankDamage` deltas provide damage credited to the Tank player.
  Positive per-Survivor `m_checkpointDamageToTank` deltas provide damage dealt
  to that Tank, including a per-player breakdown. These are authoritative
  checkpoint totals scoped to the observed control interval, not hurt events.
  Rock throws are not rock hits; exact attack cause, fire source, hittables,
  friendly fire, and pass continuity are not inferred.
- Witch encounters: each observed Witch entity lifetime retains first/last
  ticks, sample count, peak network rage/wander-rage, first
  observed enraged and burning ticks, and a bounded correlation to a nearby
  Witch death event. A rage value at or above 1 is labelled the network
  enraged threshold. Startler, target, health, crown status, and
  attacker-attributed damage, and world position remain unavailable. The raw
  cell-relative origin is retained only at the projection boundary and is never
  placed on BSP geometry.
- Spatial view: death events carry their event coordinates. State-derived
  spawns, attacks, pins, incaps, revives, clears, and Tank-control moments carry
  the corresponding observed player position when that snapshot exposes one.
  These combat-event X/Y coordinates are normalized to the observed bounds when
  a matching local map artifact is absent. An optional separately
  acquired BSP artifact can supply real static world-brush geometry in the same
  world coordinate system; it is not data extracted from the demo. BSP hash,
  byte length, BSP/map revision, extractor version, Steam build ID when
  available, ordinary/displacement face coverage, and omitted dynamic/static
  prop state stay explicit. A local catalog reports exactly which maps were
  extracted. Demo headers identify a map name but do not carry a BSP hash or
  Steam build ID, so the system cannot prove that a locally resolved BSP is the
  exact revision used by the recorded server. Valve-wrapped LZMA1 lumps needed by geometry are decoded under
  strict compressed-size, output-size, dictionary, and cumulative-byte bounds;
  codec and decoded-lump provenance are retained. Per-triangle centroid Z
  values support analytical floor slicing;
  they are derived geometry metadata, not game-authored floor names.
  A grouped game renders each map in its own coordinate system. Spatial events
  are never normalized or overlaid across different maps.
- Review: bounded aim-evidence windows with counterevidence, limitations,
  lineage hashes, and reconstruction quality. Signals are not verdicts.

## Not reliably extractable today

| Metric                                                          | Why unavailable                                                                                                                                                            | What would unblock it                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Shots, hits, misses, accuracy                                   | POV attack commands express intent, not accepted weapon fire; concise hurt covers player damage but supplies no global shot/hit/miss denominator. SourceTV omits commands. | Reliable fire/outcome events or a per-weapon shot model validated on controlled fixtures.           |
| Exact general dealt damage, attack cause, friendly fire         | Concise hurt can expose bounded player damage, but attacker entity resolution may be ambiguous and it omits weapon/hit group; health deltas include healing/resets.        | Validated tick-scoped attribution plus richer hurt/fire telemetry or server logs.                   |
| Exact damage taken                                              | Network sampling can skip changes; temp health/incaps alter health semantics.                                                                                              | Current observed health loss is only a lower bound; full validated health reconstruction is needed. |
| Shoves, deadstops, skeets, levels, crowns, general clears/saves | These are semantic sequences and key input/hurt events are absent. The narrow death-correlated clear above is the only supported clear.                                    | Validated multi-entity detectors with real corpus fixtures and precision tests.                     |
| Witch health, startler, target, crown, and attributed damage    | The Witch send table exposes rage, burning, and position, but not the necessary health/attacker fields.                                                                    | Server plugin events or another validated telemetry source.                                         |
| Server team name attached to Team A/B score                     | The first-half Survivor roster can be mapped to a score index from observed `teamsFlipped`, but the demo does not carry an external team name.                             | External match metadata or a known scoreboard.                                                      |
| Hit groups and weapon efficiency                                | Hurt/hit-group events are absent.                                                                                                                                          | Reliable hurt events or validated trace reconstruction.                                             |
| Other players' intent/input; voice; recoil compensation         | POV commands cover only the recorder and are not physical raw mouse data; SourceTV has no per-player commands and neither perspective contains private voice.              | Consented client/server telemetry; never infer absent inputs from camera movement.                  |
| Definitive cheating probability                                 | No defensible calibrated labeled L4D2 dataset exists in this project.                                                                                                      | Licensed representative labels and measured calibration/error rates.                                |

## Required change checklist

1. Add a bounded decoder/projection test and a real-corpus invariant where
   applicable.
2. Mark values observed, derived, or unavailable and preserve provenance.
3. Update this file, artifact/API types, and UI labels together.
4. Verify resets, identity slot reuse, bots, swaps, both Versus halves, missing
   events, and malformed input.
5. Never backfill missing values with zero or unsupported causal attribution.

## Downstream rating use

The experimental L4DStats Match Rating consumes only the reset-aware half,
event, SI-life, control, and checkpoint-counter values documented above. It is
a downstream derived index, not additional demo telemetry. Missing extracted
values remain missing in the model, and rating changes must keep
`docs/L4DSTATS-RATING.md` synchronized with this contract.
Observed zero values remain valid observations and contribute neutral peer
information when every compared player is zero. Cross-map aggregation is
strict: if an additive metric is unavailable for any selected map on which the
player appears, its game total remains unavailable instead of treating that map
as zero.
Player-POV command fields, concise damage events, probable-shot derivations,
aim/input measures and accuracy-like values are deliberately excluded. A
different capture perspective must not change rating eligibility, component
coverage, weights or MVP selection merely because it exposes recorder-only
telemetry.

## Hosted aggregate materialization

The hosted statistics surface stores a versioned per-demo signal count and,
for each stable Steam identity observed in that demo, its signal count plus the
shared rating projection input. These rows are derived indexes of the retained,
hash-verified result artifact; they do not replace its parser, detector, config,
map, or source lineage. Historical materialization downloads the retained
artifact, verifies its recorded byte length and SHA-256, then rebuilds the same
index idempotently.

Global signal totals and averages are available only when every hosted analysis
has the current materialization version. Player totals likewise remain missing
when any linked demo is uncovered. Survivor exposure, infected lives, metric
observations, and career rating remain missing when rating inputs are absent;
the hosted UI must not substitute zero. Career ratings are recomputed through
the canonical rating package only for players with at least 100 distinct games
and only when the eligible comparison cohort meets the model minimum.
