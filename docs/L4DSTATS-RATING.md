# L4DStats Match Rating v0.2

Status: experimental and reproducible, not scientifically validated.

The L4DStats Match Rating is a retrospective summary of a player's observable
performance in the currently selected L4D2 Versus game. It is not a career
skill estimate, cheating signal, win probability, or causal estimate of how
many points a player created.

The implementation lives in `packages/l4d2-rating`. The web adapter in
`apps/web/src/player-rating.ts` converts selected maps and halves into its
opportunity-normalized inputs. Map and round toggles therefore recompute the
rating and MVP rather than filtering a previously calculated number.

## Why the model exists

Competitive L4D2 has no accepted equivalent of the HLTV player rating. Classic
community MVP plugins primarily rank Survivors by SI damage and show CI output
separately. Rich play-stat plugins expose many additional Survivor and
Infected measures, but a large subset requires live server hooks that SourceTV
demos do not contain.

The v0.2 model follows three useful precedents without copying their formulas:

- competitive L4D2 treats Survivor and Infected output as different roles;
- a neutral rating of 1.00 is easier to interpret than an arbitrary point sum;
- the exact components and limitations must be inspectable.

## Scientific status

Scientific here means that the formula is predeclared, versioned,
deterministic, missingness-aware, testable, and designed to be falsified. It
does not mean that the current weights have been learned or validated on match
outcomes.

The current repository has no representative frozen reference population. The
v0.2 baseline is therefore explicitly game-relative. A population-calibrated
model must not replace it until there are at least 30 comparable games, 120
player-games, held-out validation, published cohort lineage, and adequate
sample counts for every retained role/config stratum.

## Unit of analysis

The adapter aggregates reset-aware player-half records across all selected
maps. Stable SteamID64 identity joins the same human across maps. Anonymous
epochs remain separate. Every input is a rate per relevant opportunity:

- Survivor counting, boss-damage, and damage-taken counters use observed
  Survivor seconds;
- ordinary Infected output uses reconstructed non-Tank SI lives;
- pin duration uses observed controls;
- Tank actions use reconstructed Tank lives.

Exposure is not awarded as performance. It controls partial pooling toward the
neutral value so a very short appearance cannot dominate the game.

## Components and weights

Survivor Rating:

| Pillar         | Role weight | Components                                                                     |
| -------------- | ----------: | ------------------------------------------------------------------------------ |
| Threat removal |         45% | attributed SI kill rate 100%                                                   |
| Rescue         |         20% | revive rate 70%, narrow death-correlated clear rate 30%                        |
| Durability     |         20% | lower death rate 35%, lower incap rate 30%, lower engine damage-taken rate 35% |
| Boss output    |         15% | Tank damage rate 80%, Witch damage rate 20%                                    |

Infected Rating:

| Pillar     | Role weight | Components                                                                  |
| ---------- | ----------: | --------------------------------------------------------------------------- |
| Conversion |         45% | class-damage per life 50%, incaps per life 30%, kills per life 20%          |
| Control    |         30% | controls per life 60%, sampled pin seconds per control 40%                  |
| Setup      |         15% | Boomer actions 35%, Smoker pulls/hangs 25%, charge victims 25%, pounces 15% |
| Tank       |         10% | registered punches 70%, registered throws 30%                               |

These are domain weights, not fitted coefficients. Correlated facts are kept in
the same capped pillar. Registered Tank throws are never called rock hits.

V0.2 removes the former CI kill-rate component. Fresh CEDAPug game `916532`
proved that `m_checkpointZombieKills` includes Special Infected kills and
cannot be safely decomposed using the incomplete SourceTV death-event stream.
Threat removal now uses attributed SI deaths only. The raw checkpoint total
remains visible as a descriptive total infected-kill counter but contributes no
rating points.

Tank damage, Witch damage, damage taken, and infected class damage are
networked checkpoint counters for the player and half. They are useful
aggregate output, but they do not provide an exact event-by-event
attacker/victim damage ledger. `m_checkpointSurvivorDamage` is damage inflicted
by a player while controlling Infected, despite its misleading engine name. It
is never used as Survivor damage output.

### Real-corpus semantic check

The four ignored `915679` Hard Rain demos were parsed together after the
counter-direction correction. All eight Steam identities received eligible
Survivor and Infected role scores with 100% model-input coverage, and the MVP
resolved to BINGO #HDP at 1.219. This is a regression check for extraction,
aggregation, and eligibility. It is not population calibration or proof that
the domain weights predict wins better than another model.

## Normalization and shrinkage

For a metric with at least four observed peers and a positive peer total:

```text
positive peer index = observed peer count * player rate / sum(peer rates)
lower-is-better index = 2 - positive peer index
bounded peer index = clamp(index, 0.60, 1.40)
reliability = exposure / (exposure + shrinkage half-life)
adjusted index = 1 + reliability * (bounded peer index - 1)
```

The shrinkage half-life is 300 observed Survivor seconds, four ordinary SI
lives, or one Tank life depending on the metric. The implementation preserves
the raw rate, peer index, reliability, adjusted index, source class, and signed
contribution for every displayed metric.

Missing telemetry is never changed to zero. A missing metric is omitted and
the observed component weights are renormalized inside the pillar. A role
rating requires at least 70% planned pillar coverage, at least two observed
pillars, and at least 120 Survivor seconds or three ordinary SI lives.

An observed zero is not missing. When at least four peers all have an observed
zero for a metric, it contributes a neutral 1.00 peer index and retains its
coverage. Composite counters are admitted only when every named component is
observed, so an absent component cannot be silently imputed as zero.

An overall rating requires both eligible role ratings and at least two selected
maps:

```text
L4DStats Rating = 0.50 * Survivor Rating + 0.50 * Infected Rating
```

The equal split reflects the Versus side swap. It prevents a player with data
from only one role from being ranked as the overall match MVP.

## MVP rule

The Game MVP is the highest unrounded eligible overall rating. Players within
0.02 of the numeric leader are reported as an unresolved shared edge. The
model does not invent an unrelated gameplay tie-breaker. Coverage and stable
player key affect deterministic ordering but not the performance score.

Confidence is low or medium in v0.2. High confidence is intentionally
unavailable until leave-one-map-out stability and a frozen population baseline
are implemented and validated.

## Excluded information

The rating deliberately excludes shots, accuracy, hit groups, friendly fire,
skeets, deadstops, levels, crowns, general clears, rock hits, hittable damage,
voice, private input, aim signals, and cheating evidence. It also excludes
maximum pounce damage and maximum Jockey ride because maxima grow with
opportunity and are poor rate statistics.

Player-POV command fields, `player_hurt_concise`, and any future probable-shot,
input-angle or accuracy-like derivations remain excluded. Recorder-only
telemetry must not change rating coverage, eligibility, weights, confidence or
MVP selection, and SourceTV and POV results must remain comparable on the same
documented server-observed inputs.

Resource use and ghost time remain context, not automatic positive or negative
points. Consuming a medkit is not inherently good, and waiting in ghost can be
part of coordinated play.

## Required validation before v1

1. Freeze a representative corpus and publish its hash, collection rules,
   config families, maps, missingness, and exclusions.
2. Estimate role/config reference distributions without using the target game.
3. Measure split-map test-retest reliability and leave-one-map-out MVP
   stability.
4. Run component-removal and weight perturbation sensitivity analyses.
5. Test association with held-out team map score as criterion evidence without
   calling it causal validity.
6. Audit substitutions, reconnects, partial halves, config strata, map strata,
   and identity failures.
7. Publish every model-version rank change.

Weights must never be tuned merely to make familiar players win.

## Primary references

- [L4D2 Competitive Rework `survivor_mvp` SI-damage ranking](https://github.com/SirPlease/L4D2-Competitive-Rework/blob/6cb2fcbe092776c8287944ab541244e2b8262662/addons/sourcemod/scripting/survivor_mvp.sp#L1176-L1195)
- [`l4d2_playstats` Survivor taxonomy](https://github.com/Tabbernaut/L4D2-Plugins/blob/9a0e0eab9742dbeb0590a1a2608cb1f216b90516/stats/l4d2_playstats.sp#L258-L338)
- [`l4d2_playstats` Infected taxonomy](https://github.com/Tabbernaut/L4D2-Plugins/blob/9a0e0eab9742dbeb0590a1a2608cb1f216b90516/stats/l4d2_playstats.sp#L341-L369)
- [HLTV Rating 2.0 methodology](https://www.hltv.org/news/20695/introducing-rating-20)
- [NIST median absolute deviation](https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/mad.htm)
- [OECD/JRC composite-indicator handbook](https://www.oecd.org/content/dam/oecd/en/publications/reports/2008/08/handbook-on-constructing-composite-indicators-methodology-and-user-guide_g1gh9301/9789264043466-en.pdf)
- [Efron and Morris on shrinkage estimation](https://doi.org/10.1080/01621459.1975.10479864)

The statistical references motivate transparency, robust future baselines,
partial pooling, and sensitivity analysis. They do not validate the L4DStats
weights.
