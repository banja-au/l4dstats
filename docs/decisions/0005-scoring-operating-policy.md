# ADR 0005: Gate review priority by evidence adequacy and calibration

- Status: accepted for Sprint 3 research evaluation
- Date: 2026-07-17

## Context

Sprint 2 emits reproducible detector evidence without a combined score. Sprint 3
must aggregate that evidence without converting correlated ticks or missing telemetry
into false certainty. Available labeled data is a governed controlled fixture. The
22-demo CEDAPug corpus is unlabeled and homogeneous SourceTV protocol 2100 data.
Independent framing and licensed playback validation also remain pending.

Consequently, Sprint 3 can validate scoring machinery and operating gates but cannot
claim real-world probability, prevalence, or enforcement fitness.

## Decision

WitchWatch exposes one of three mutually exclusive score states:

1. `insufficient-data`: required evidence, reconstruction quality, or applicability
   is absent. No numeric review priority exists.
2. `ranked-evidence`: evidence can be ordered, but calibration or its support
   gate fails. No numeric review priority or probability exists.
3. `calibrated-priority`: the controlled-fixture calibration and policy gates pass. A
   numeric research value may be emitted with quality, uncertainty, provenance,
   limitations, and counterevidence.

The value is a review priority, not the probability of cheating or software use.
Thresholds never trigger enforcement or public accusation.

### Independent evidence

Ticks are not independent. They collapse into versioned encounters. Independent
demo support requires distinct demo hashes. Orthogonal support requires distinct
predeclared signal families, not merely distinct detector IDs or versions. The
versioned operating configuration freezes:

- encounter grouping and per-encounter/per-detector caps;
- minimum independent encounters, demos, and signal families;
- minimum reconstruction completeness and quality;
- model applicability requirements; and
- which detector families are considered orthogonal.

Only positive-strength evidence with nonzero quality can count toward these minima
or corroboration. The policy's explicit orthogonal-family allowlist, rather than the
mere presence of different detector names, controls the second corroboration path.

Unknown telemetry remains unknown. It cannot be imputed as benign evidence or used
to inflate an evidence count.

### Numeric withholding

The engine returns `insufficient-data` when any minimum independent-evidence,
reconstruction, required-field, provenance, or applicability rule fails. The numeric
field is absent, not `null` or zero.

The engine returns `ranked-evidence` when sufficient evidence exists but model
support, calibration quality, or the predeclared operating budget fails. This state
preserves deterministic ordering, contributions, strongest counterevidence,
limitations, quality, and tick links while structurally forbidding numeric priority
and probability fields.

### `highly-anomalous` policy

The categorical label `highly-anomalous` is allowed only when:

- reconstruction meets the versioned adequate-quality and completeness rules; and
- qualifying evidence persists across distinct demos **or** qualifying evidence
  comes from at least two predeclared orthogonal signal families.

Both paths still require the general independent-evidence and provenance gates. A
large number of ticks, repeated windows from one encounter, multiple correlated aim
detectors, or model magnitude alone cannot satisfy the rule. Every failing
prerequisite yields a lower category or `insufficient-data` according to the decision
table; it is never rounded up.

### Calibration and operating budget

The controlled-fixture evaluation uses the preregistered split, false-positive
budget, calibration thresholds, and poor-calibration fallback in the calibration
report. Player groups and fixture families cannot cross splits. Evaluation and
bootstrap units are players.

Failure of any calibration gate produces `ranked-evidence`. The system does not
publish an uncalibrated probability. Passing supports only a fixture-conditional
research review priority and does not transfer its error rate to real players.

## Label governance

Eligible labels come only from documented synthetic generation, consented controlled
sessions, or blinded expert review with complete provenance. Reports, reputation,
high skill, prior model output, and moderation outcomes are not positive labels.

Human labeling retains every blinded vote, confidence, rationale, disagreement, and
adjudication. Disputed and indeterminate players are excluded from fitting,
calibration, threshold selection, and headline metrics, but remain a reported
challenge slice. Adjudication appends lineage and never overwrites original votes.

## Required presentation

Every user-facing result includes:

- score state and its reason;
- independent encounter, demo, and family counts;
- reconstruction quality and missingness;
- versioned contributions and caps;
- limitations and strongest benign counterevidence;
- precise tick references; and
- demo, parser, detector, model, policy, configuration, and asset provenance.

The interface must use `review priority`, `insufficient data`, or `highly anomalous`.
It must never label a player a cheater.

## Prohibited claims and uses

- Cheating probability, likelihood, proof, or causal software attribution.
- Automatic bans, moderation, sanctions, or public accusations.
- Real-player or CEDAPug accuracy, calibration, false-positive rate, predictive
  value, or prevalence from controlled or unlabeled data.
- Treating CEDAPug demos as clean, positive, or ground truth.
- Representative population validity, demographic fairness, or cross-protocol/POV
  performance.
- Direct mouse/input inference from SourceTV networked eye angles.
- Exact visibility claims without licensed, versioned geometry.
- Reconstruction-accuracy claims while reference validation is pending.

## Release blockers

The research model cannot become decision support until all of these are complete:

- independent outer-framing comparison and selected-tick licensed L4D2 playback
  validation;
- a consented, representative, player-separated held-out evaluation with a newly
  predeclared real-world false-positive budget;
- prospective blinded shadow-mode evaluation without enforcement;
- documented subgroup/context errors and drift monitoring;
- privacy, retention/deletion, correction, appeal, and incident procedures; and
- explicit maintainer release review.

An immutable bundle binds data, features, model, calibrator, and policy. Any change
requires a new version and complete reevaluation. Automated bans remain permanently
out of scope.

## Consequences

- Sprint 3 can prove the G2 insufficient-data, G3 corroboration, and G4 fallback
  behavior without overstating the fixture.
- A controlled-fixture operating point may satisfy the Sprint 3 engineering gate,
  but is prominently research-only and reference-validation-pending.
- Poor calibration degrades to useful, explainable ranked evidence rather than a
  misleading number.
- Real-world calibration and decision-support readiness remain future empirical and
  governance work, not conclusions inferred from software tests.
