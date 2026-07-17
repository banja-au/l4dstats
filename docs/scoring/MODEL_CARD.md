# Sprint 3 scoring model card

- Status: research-only controlled-fixture model
- Model-card version: 1.0.0
- External reference validation: pending
- Population validity: not established

## Intended output

The model estimates a fixture-conditional **review priority**. It does not estimate
the probability that a player cheated, used software, violated a rule, or deserves
an enforcement action. Its numeric interpretation is restricted to the governed
dataset distribution identified by the immutable model bundle.

The public score contract has three operational states:

- `insufficient-data`: evidence prerequisites fail and no numeric priority exists;
- `ranked-evidence`: evidence can be ordered, but calibration is unsupported and
  no numeric priority exists; and
- `calibrated-priority`: a controlled-fixture-calibrated value may be emitted for research
  evaluation with its quality, uncertainty, limitations, and provenance.

An absent numeric field is not zero. Consumers must not synthesize one.

## Model bundle and reproducibility

An immutable bundle must contain or hash-bind:

- score-contract, feature, detector, aggregation, policy, model, and calibrator
  versions;
- dataset and split manifests and their SHA-256 digests;
- training/evaluation configuration and source revision;
- feature names, units, directions, caps, missingness behavior, and coefficients;
- fitted preprocessing and calibration parameters;
- training runtime/dependency versions;
- the exact reproducibility command; and
- the generated calibration report and digest.

Any change to data, labels, split, features, caps, policy, model, or calibrator creates
a new bundle version and requires a complete evaluation. A mutable “latest” bundle
is not an auditable input.

## Modeling constraints

The baseline must be interpretable. Aggregation follows tick to encounter to demo to
player. Ticks are never independent samples. Detector and encounter influence is
capped before cross-demo aggregation, and unknown inputs remain unknown rather than
becoming zero-valued benign evidence.

The implementation must expose contributions, reconstruction quality, independent
encounter/demo/family counts, limitations, strongest counterevidence, and exact tick
references. The operating policy, rather than the fitted model, determines whether a
numeric value or `highly-anomalous` category is allowed.

## Training and evaluation

Only governed eligible labels described in the dataset card may be fitted. Player
and fixture families cannot cross splits. Learned preprocessing and model fitting use
training players; calibrator fitting uses calibration players; the policy threshold
is frozen before the held-out evaluation players are opened;
the held-out evaluation split is not used for retuning. Confidence intervals and
resampling use the player as the unit.

The model card must be generated with the following result fields populated from an
artifact, not hand-written:

- player/demo/encounter counts by split and label, sourced from the bound dataset
  manifest; units absent from a synthetic player-level fixture must be explicitly
  `not-applicable` rather than reported as zero;
- model and calibrator method;
- Brier score and constant-prevalence baseline;
- log loss, fixed-bin calibration error, and maximum reliability-bin gap;
- precision-recall summary;
- the selected threshold, false positives per 1,000 players, recall, precision, and
  player-level intervals;
- assumed-prevalence predictive-value sensitivity; and
- every required distribution-shift slice with support or `not evaluated`.

Until a generated artifact supplies those values, results are **pending** and no
performance claim is supported.

## Intended use

- Reproducible local research into evidence prioritization.
- Testing insufficient-data and poor-calibration safeguards.
- Human review of exact evidence windows with visible counterevidence.

## Prohibited use

- Automated bans, moderation, sanctions, or threshold-triggered action.
- Public accusation, naming, identity resolution, or player ranking.
- Estimating cheating prevalence or software use.
- Treating CEDAPug demos, community reports, or high skill as ground truth.
- Transferring controlled-fixture calibration to real players.
- Hiding reconstruction limitations, uncertainty, or disagreement.

## Limitations and failure modes

- `reference-validation-pending`: independent parser framing and licensed matching
  L4D2 playback comparisons have not passed.
- The real corpus is unlabeled and homogeneous protocol-2100 SourceTV data.
- Networked eye angles are not direct inputs and may be quantized or interpolated.
- High skill, latency, sensitivity, device, maps, mods, protocol drift, and adaptive
  assistance may shift feature distributions.
- Correlated detectors can create false confidence unless family and encounter caps
  are preserved.
- Blinded experts may disagree; reports remain annotations, not objective positives.
- Calibration can fail silently after drift unless the versioned applicability and
  calibration gates are rerun.

## Human oversight and correction

A reviewer must see the strongest benign explanation, limitations, provenance, and a
tick deep link before acting outside the tool. The tool itself takes no action.
Corrections preserve the original result and append reviewer/adjudication lineage.
Any future decision-support release requires retention, appeal, monitoring, and
incident procedures in addition to the scientific release blockers.
