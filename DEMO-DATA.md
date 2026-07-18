# Demo data contract

This is the source of truth for what L4DStats extracts from L4D2 SourceTV
`.dem` files. Update it in the same change as any decoder, projection, artifact,
or statistic change. Never present an unavailable value as zero.

## Supported input

- Source 1 demo protocol `4`, L4D2 network protocol `2100`.
- SourceTV demos. Other protocols and POV demos are unsupported until an
  explicit decoder is implemented and tested.
- `userinfo` identity is correlated by effective tick and entity slot. Player
  names and decimal SteamID64 values are retained in the local analysis
  artifact for display and Steam profile links. Steam IDs also become keyed
  stable tokens for safe cross-demo joins; join logic never relies on names.
  The networked fake-player flag distinguishes bots from human identities.
  If an early entity epoch predates its `userinfo` row, the epoch inherits a
  later identity only when that entity slot exposes exactly one distinct human
  identity across the entire demo (`unique-slot-v1`). Ambiguous slot reuse stays
  anonymous, and the artifact marks whether identity was observed or inferred.

## Directly decoded data

| Source                                   | Retained data                                                                                                                                                                                                                                                  | Limits                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo header                              | map, playback time/ticks, byte size, protocols                                                                                                                                                                                                                 | Header time can include non-play time.                                                                                                                                                                                                                                          |
| Demo framing                             | command kind/tick, packets, sign-on, data/string tables                                                                                                                                                                                                        | Corrupt or ambiguous framing fails closed.                                                                                                                                                                                                                                      |
| `svc_Tick`                               | engine tick                                                                                                                                                                                                                                                    | Demo and engine ticks are distinct clocks.                                                                                                                                                                                                                                      |
| Data tables, baselines, `PacketEntities` | bounded entity snapshots/deltas                                                                                                                                                                                                                                | Only networked send properties exist.                                                                                                                                                                                                                                           |
| `CTerrorPlayer`                          | position, eye angles, team, named L4D2 class, weapon, health/temp health, life/incap/ghost state, Versus team, Tank frustration, pin relationships, checkpoint total infected kills/revives/incaps/SI incaps/pounces/highest pounce damage/longest Jockey ride | SourceTV omits user-command buttons. Counters can reset at round/team transitions.                                                                                                                                                                                              |
| `CTerrorPlayerResource`                  | player-indexed primary weapon, first-aid slot, temporary-health slot, health/max-health arrays and round setup time                                                                                                                                            | Slot values are networked L4D2 weapon IDs. Possession changes do not prove use, transfer source, shots, hits, or intent.                                                                                                                                                        |
| `Witch`                                  | entity lifetime, cell-relative origin, rage, wander rage, and burning state                                                                                                                                                                                    | The inspected entity snapshots omit the cell state needed to normalize the Witch origin into world coordinates. Witch health, attacker, startler, and damage attribution are also absent.                                                                                       |
| `CTerrorGameRulesProxy`                  | campaign/chapter/Survivor scores, per-Survivor Versus/death distance, round duration/number, team flip and second-half state                                                                                                                                   | Team labels remain neutral until roster-to-score attribution is externally validated.                                                                                                                                                                                           |
| `userinfo`                               | entity mapping, normalized protocol-2100 user ID, player name, decimal SteamID64, privacy-safe stable token                                                                                                                                                    | XUID uses network byte order while adjacent scalars are little-endian; human IDs are corpus-validated against the Steam individual-account shape. Names are untrusted display text and can change or collide. Slot reuse is epoch-scoped; malformed identity stays unavailable. |
| `svc_GameEventList`/`svc_GameEvent`      | every event schema/payload actually sent                                                                                                                                                                                                                       | Inspected CEDAPug SourceTV commonly sends only deaths, team/disconnect, round boundaries, and HLTV status. Never assume other events exist.                                                                                                                                     |
| `player_death`                           | user IDs, weapon, headshot, bot flags, infected victim class, death position                                                                                                                                                                                   | It does not provide damage, assists, hits, or shots. An empty victim name commonly denotes a Survivor death.                                                                                                                                                                    |

## Derived artifact statistics

- Game/session evidence: an HMAC-protected embedded SourceTV server identity,
  privacy-safe stable-human-roster token, Source server generation counter,
  campaign code, and chapter ordinal. L4D2 demos do not expose a universal
  match UUID. The workbench therefore groups maps only when server, roster,
  campaign, and adjacent generation evidence agree. It records whether that
  association is provisional, high-confidence, or unassociated. Filenames are
  never used for grouping.

- Demo: duration, tick rate, observation/event counts, decode issues, and field
  availability.
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

| Metric                                                          | Why unavailable                                                                                                                                      | What would unblock it                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Shots, hits, misses, accuracy                                   | SourceTV omits player commands; inspected demos omit `weapon_fire`/hurt events.                                                                      | Reliable events or a per-weapon ammo model validated on fixtures.                                   |
| Exact general dealt damage, attack cause, friendly fire         | `player_hurt` is absent; health deltas do not identify attackers and include healing/resets. Tank checkpoint totals above are the bounded exception. | Hurt events, server stats logs, or validated attacker/damage state.                                 |
| Exact damage taken                                              | Network sampling can skip changes; temp health/incaps alter health semantics.                                                                        | Current observed health loss is only a lower bound; full validated health reconstruction is needed. |
| Shoves, deadstops, skeets, levels, crowns, general clears/saves | These are semantic sequences and key input/hurt events are absent. The narrow death-correlated clear above is the only supported clear.              | Validated multi-entity detectors with real corpus fixtures and precision tests.                     |
| Witch health, startler, target, crown, and attributed damage    | The Witch send table exposes rage, burning, and position, but not the necessary health/attacker fields.                                              | Server plugin events or another validated telemetry source.                                         |
| Server team name attached to Team A/B score                     | The first-half Survivor roster can be mapped to a score index from observed `teamsFlipped`, but the demo does not carry an external team name.       | External match metadata or a known scoreboard.                                                      |
| Hit groups and weapon efficiency                                | Hurt/hit-group events are absent.                                                                                                                    | Reliable hurt events or validated trace reconstruction.                                             |
| Voice, intent, player input, recoil compensation                | SourceTV has no private voice and no per-player user commands.                                                                                       | POV or server telemetry; never infer absent inputs from camera movement.                            |
| Definitive cheating probability                                 | No defensible calibrated labeled L4D2 dataset exists in this project.                                                                                | Licensed representative labels and measured calibration/error rates.                                |

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
