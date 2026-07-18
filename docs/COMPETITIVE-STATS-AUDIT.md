# Competitive Versus statistics audit

This audit compares the current analysis artifact with the questions an
experienced L4D2 Versus player asks after a match. It is an implementation
backlog, not a promise that absent SourceTV telemetry can be reconstructed.
`DEMO-DATA.md` remains the authoritative extraction contract.

Last audited: 17 July 2026.

## Implemented since this audit

- Reset-aware half records, neutral side rosters, per-half player counter
  deltas, half-bounded player summaries, SI lives, inferred hit clusters,
  death-correlated clears, and Tank encounters are now append-compatible
  analysis outputs. The web scope model uses those summaries to recompute
  player, combat, timeline, health and coverage views for selected halves.
- The competitive scoreboards expose Survivor Tank and Witch damage, damage
  taken, resource use, first-aid sharing, melee kills, and four-player shares
  only when roster coverage is complete. General Survivor damage to SI is not
  available from these demos.
- Infected scoreboards expose per-life controls and pin time, class-specific
  damage, incaps, Tank actions, Smoker pulls, Boomer actions, charge victims,
  and pushes. Registered throws remain explicitly distinct from rock hits.
- Witch entity lifetimes now retain observed rage, wander-rage, burning state,
  and bounded death correlation. The report keeps startler, crown, health,
  damage attribution, and world position unavailable because the inspected
  SourceTV state cannot support them.
- Survivor health review now retains bounded permanent-health, raw buffer, and
  incap traces at material changes and one-second sampling intervals. It does
  not label these traces exact damage or calculated effective health.
- Multi-map games aggregate stable Steam identities while preserving
  unavailable optional values. Anonymous epochs never merge across demos.
- Neutral Roster A/B membership is reconstructed from the observed side swap
  and shown per map. Complete four-player swaps are high confidence; partial
  and single-half membership remains provisional and is not attached to engine
  score indices.

The Priority 2 projection and validation items remain open. This section records
implemented product behavior and does not change the correctness boundaries
below.

## Verdict

The current artifact has useful raw material but is not yet a complete
competitive scoreboard. Its largest correctness problem is aggregation: one
row combines both sides, every SI class, and the whole demo. Competitive review
needs **match → half → roster → player → SI life/hit** structure. Adding more
whole-demo totals before that split would make the report denser, not better.

Player names and SteamID64 values are available from valid `userinfo` entries
and already belong in the artifact. A missing or malformed identity must remain
explicitly unavailable; an alias is a fallback, not evidence that SourceTV never
contains player identity.

## What a competitive report should answer

1. Who played, which roster were they on, and which side did they play in each
   half?
2. What was the score/progress result of each Survivor attempt and where did it
   end?
3. How much Survivor output, attributed SI removal, resource use, and avoidable loss
   did each player contribute?
4. How effective was each infected player by class and by life, and how well did
   the four-player hit synchronize?
5. What happened during each Tank and Witch encounter?
6. Which plays decided the round, and can the reviewer inspect their exact tick
   and map location?
7. Which values are direct engine counters, bounded observations, or unavailable?

## Priority 0 - correct the analytical grain

These changes unlock almost every useful comparison and should precede new UI
leaderboards.

| Addition               | Honest derivation from current decode                                                                                                | Required output                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Half segments          | Split at the observed `secondHalf` game-rules transition and round events; preserve unknown boundaries                               | Two neutral `half` records with tick range, duration, score/progress snapshots and quality                                           |
| Roster membership      | Stable Steam identity/connection epoch plus observed Survivor/Infected team in each half                                             | Neutral Roster A/B membership; do not attach score indices until mapping is validated                                                |
| Per-half player stats  | Delta/reset-aware checkpoint counters inside each half instead of a demo-wide maximum                                                | Survivor and infected stat blocks per player per half, each with availability                                                        |
| SI lives               | Ghost-to-spawn transition, class, pin/counter transitions and matching death/team/class transition                                   | One record per observed life with start/end tick, class, duration, attacks, controls, damage counters and termination reason/unknown |
| Counter reset handling | Segment counters at decreases, round transitions and connection epochs; sum only validated positive deltas within the intended scope | No cross-half maximum presented as a match total                                                                                     |

The existing `playedSurvivor && playedInfected` state is normal in Versus and
does not warrant a visible “Both sides” badge. Side is a column/section context,
not a player identity label.

## Priority 1 - high-value additions available now

### Survivor half scoreboard

All of the following can be surfaced from already projected checkpoint counters
or death events, provided they are half-segmented and retain availability:

- SI kills and kills by SI class; headshot kills where `player_death` says so;
- checkpoint total infected kills and broadly scoped melee kills; exact Common
  Infected kills are unavailable;
- direct engine counters for Tank damage and Witch damage;
- pills, adrenaline, medkits, defibs and throwables used;
- revives, incaps and deaths;
- first-aid shares;
- direct `m_checkpointDamageTaken` alongside separately labelled **observed
  health loss lower bound**;
- each player's share of the four-person Survivor total for SI kills, Tank
  damage and resource use. The checkpoint total infected-kill counter is
  descriptive only because it includes SI and cannot be safely decomposed.

Shares, rates per minute, and rank are simple derived values, but only when all
four roster members have the relevant counter available. Do not rank partial
coverage against complete coverage.

### Infected half scoreboard

The current state supports a much more legible class-performance table:

- Survivor damage, incaps and kills;
- class-specific damage counters for Smoker, Boomer, Hunter, Spitter, Jockey,
  Charger and Tank;
- pounces and highest pounce damage;
- Smoker pulls and longest grab;
- Boomer vomits;
- Charger victims;
- Jockey longest ride;
- Tank punches and rock throws;
- observed pin time, ghost time, spawned lives and deaths by class;
- damage per spawned life, controls per spawned life, pin seconds per control,
  and time alive per life when their inputs are complete.

Raw netprop names should not be the primary presentation. Keep them in a
provenance drawer; expose domain labels with `observed`, `engine counter`, or
`derived` badges.

### Clears and control response

The existing narrow clear rule is defensible: a pin ending within 0.5 seconds of
a `player_death` naming the pinning SI and a Survivor killer. Aggregate those
events into:

- confirmed death-correlated clears per Survivor;
- clear response time from matching pin start;
- pinned teammate and SI class;
- team median response time where coverage is complete.

Call these **death-correlated clears**, never all clears. Shove clears, tongue
breaks and displacement clears remain unavailable.

### Attack cycles (“hits”)

Cluster observed non-Tank SI spawn, attack/control and death events into bounded
attack cycles using a documented time-gap rule. Report facts rather than a
subjective coordination grade:

- classes present and players involved;
- first/last spawn and first/last control ticks;
- spawn spread and control spread in seconds;
- landed controls, booms and observed incaps;
- aggregate direct infected damage-counter delta;
- simultaneous pin peak derived from active pin intervals;
- duration until every observed participating SI life ended.

Label this an inferred hit segmentation with its rule/version. Sack lives and
failed attacks cannot always be distinguished from a coordinated hit.

### Tank encounters

Create one encounter for every observed Tank-class control segment, joined across
control passes when possible:

- controller(s), control start/end ticks and control duration;
- health at take, lowest observed health and health at pass/death;
- frustration trace and pass/termination reason where observable;
- punches and registered rock throws by controller;
- Tank damage by each Survivor and team share from direct counters;
- Survivor incaps/deaths, pins and SI attack events during the encounter window;
- normalized/world positions and a tick deep link.

Do not infer rock hits from the throw counter, fire source, hittable ownership or
damage attribution without supporting telemetry.

### Round story

The score progression, event timeline and player state permit compact “turning
point” lanes without inventing an impact score:

- round/half boundaries and score/progress changes;
- SI attack-cycle bands;
- active pins as duration bars, not list rows;
- incaps, deaths, revives, confirmed clears and Tank encounters as markers/bands;
- roster lanes and class icons;
- click-through from every item to tick and map position.

## Priority 2 - valuable, but requires more projection or validation

| Addition                       | Needed work                                                                                                                  | Correctness boundary                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Survivor health/resource curve | Implemented: health/temp-health/incap traces plus primary, first-aid and temporary-health loadout changes by player and half | Sampling makes damage a lower bound; possession changes do not prove item use or transfer source |
| Flow progress curve            | Project/validate nav flow or the authoritative game-rules distance semantics against map assets                              | Euclidean movement is not map progress                                                           |
| Boss flow percentages          | Decode boss-flow game-rules/director values and map max-flow data                                                            | Map/config dependent; do not derive from death coordinates                                       |
| Witch encounter detail         | Project Witch entity state and join startle/target/death where present                                                       | Witch death alone cannot establish crown, startler or damage attribution                         |
| Config fingerprint             | Capture server cvars/plugin/config evidence present in sign-on/string data                                                   | Demo filename/server reputation is not a config manifest                                         |
| Pause/restart/live phases      | Decode relevant events/state and verify against known matches                                                                | Round duration and per-minute rates are misleading until pauses are excluded                     |
| Weapon possession/use timeline | Implemented from `CTerrorPlayerResource` slots plus sampled active-weapon clip, reserve, reload and upgrade state            | Possession and active-weapon samples do not prove shots, hits or accuracy                        |

## Explicitly unavailable from inspected SourceTV telemetry

Do not add these as zero-valued columns:

- shots, hits, misses, reliable accuracy and hit groups;
- exact attacker-attributed damage, assists and friendly fire;
- skeets, dead-stops, levels and crowns;
- all clears/saves;
- rock hits, hittable hits and their damage;
- intent, comms, player input or definitive misconduct probability.

The competitive plugins in L4D2 Competitive Rework compute many of these live by
hooking rich server events such as hurt, weapon and class-specific events. Their
output is a useful product benchmark, but their implementation also demonstrates
why those metrics cannot be recreated from a SourceTV file that did not record
the required event payloads.

## Concrete implementation order

1. Introduce append-compatible `halves[]`, `rosters[]` and `player.halves[]`
   artifact records with counter availability/reset tests.
2. Introduce `infectedLives[]`, then derive class efficiency and hit clusters.
3. Promote Tank control into `tankEncounters[]` and aggregate confirmed clears.
4. Replace raw-counter-first presentation with Survivor, Infected, Tank and
   Resources scoreboards; retain a provenance/raw-data drawer.
5. Add duration-based round lanes and map-linked event selection.
6. Only then extend projection for health/resources, nav flow, Witch and config.

## Acceptance evidence

- Golden tests cover both halves, side swap, a counter reset, reconnect/slot
  reuse, a Tank pass, missing identities and missing counters.
- Real-corpus invariants show eight stable participants where appropriate and
  never merge two connection epochs merely because a slot was reused.
- Every displayed cell identifies its source as direct counter, event, sampled
  lower bound, derived sequence or unavailable.
- Per-half totals reconcile with their player inputs, or show incomplete
  coverage instead of a number.
- A reviewer can move from a roster/player summary to the exact half, SI life,
  Tank encounter, timeline interval and map tick that produced it.

## Benchmark sources

- [L4D2 Competitive Rework](https://github.com/SirPlease/L4D2-Competitive-Rework)
  is the maintained competitive config/plugin collection used to identify what
  players expect from live MVP and play-stat reporting.
- [Left4DHooks weapon IDs](https://github.com/SilvDev/Left4DHooks/blob/master/sourcemod/scripting/include/left4dhooks_stocks.inc#L1598)
  provide the named L4D2 weapon-ID table used for player-resource loadout
  values. Local corpus checks independently correlate the observed primary IDs
  with reconstructed active weapon classes.
- [`survivor_mvp.sp`](https://github.com/SirPlease/L4D2-Competitive-Rework/blob/master/addons/sourcemod/scripting/survivor_mvp.sp)
  tracks SI/common/Tank/Witch damage, kills, friendly fire and Tank-window stats
  from live server hooks.
- [`l4d2_playstats.sp`](https://github.com/SirPlease/L4D2-Competitive-Rework/blob/master/addons/sourcemod/scripting/l4d2_playstats.sp)
  is the richer competitive play-stat benchmark, including class attacks and
  skill-event aspirations such as clears.
- [`l4d2_stats.sp`](https://github.com/SirPlease/L4D2-Competitive-Rework/blob/master/addons/sourcemod/scripting/l4d2_stats.sp)
  demonstrates that skeet/team-skeet and shot/damage attribution require live
  hurt/death/class events unavailable in the inspected SourceTV event stream.
