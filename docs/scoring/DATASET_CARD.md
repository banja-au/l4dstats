# Sprint 3 controlled calibration dataset card

- Status: controlled-fixture dataset; research use only
- Card version: 1.0.0
- Label unit: player, never tick
- External reference validation: pending

## Purpose and scope

This dataset exists to test whether L4DStats can train, calibrate, evaluate, and
withhold a review-priority estimate reproducibly. It is a governed synthetic or
controlled fixture, not a sample of the L4D2 player population. It may demonstrate
software behavior and policy gates; it cannot establish real-world accuracy,
prevalence, fairness, or moderation utility.

The ignored CEDAPug corpus is separate. Its demos may exercise parsing, inference,
missingness, and distribution-shift reporting, but they have no outcome labels and
must not be used to fit a model, tune an operating point, calculate accuracy, or
identify purported positive or negative players.

## Required manifest

Every dataset release must have an immutable, machine-readable manifest containing:

- schema, dataset, generator, scenario-library, and label-policy versions;
- a SHA-256 digest for every external source and derived sub-manifest (the model
  bundle supplies the digest of this manifest because a file cannot contain its own
  digest);
- generator configuration and seed, or controlled-session configuration;
- creation time, owner, redistribution basis, and retention policy;
- the player-level split assignment and split-manifest digest;
- player, demo, encounter, and signal-family counts by split and label, with an
  explicit `not-applicable` reason when a synthetic player-level fixture has no
  source-demo unit;
- observed reconstruction-quality and missingness distributions, or an explicit
  `not-applicable` reason when reconstruction is upstream of the fixture;
- exclusions with stable reason codes; and
- derivation lineage through evidence, features, and labels.

A model bundle must refer to the manifest digest, not merely a dataset name. Raw
demos, player identifiers, reviewer identities, clips, and private source data are
never committed.

## Label semantics

The allowed review labels are:

| Label                              | Meaning                                                               | Training use                         |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| `routine`                          | Controlled evidence was designed to resemble an ordinary review case. | Eligible when provenance rules pass. |
| `review-worthy-controlled-anomaly` | A declared fixture condition should be prioritized for human review.  | Eligible when provenance rules pass. |
| `indeterminate`                    | Available evidence does not support either controlled-fixture label.  | Never fitted or calibrated.          |

Labels describe fixture review priority. They do not mean “clean,” “cheater,” or
“cheating software present.” A separate `controlledCondition` records `baseline` or
the exact named injected/configured behavior. This condition is evidence about the
fixture construction, not a conclusion about a real person.

Allowed provenance kinds are `synthetic-generator`, `consented-controlled`, and
`blinded-review`. Each label record preserves:

- source artifact and tick-range digests;
- fixture condition and configuration version;
- consent and redistribution basis where a person participated;
- pseudonymous annotator ID, timestamp, confidence, and rationale;
- every original vote, agreement statistic, dispute state, and adjudication version;
- generator and transformation lineage; and
- a reason for inclusion, exclusion, or challenge-only use.

Community reports, enforcement history, model output, player reputation, and high
skill are not positive labels.

## Blinding, disagreement, and adjudication

Human review labels require at least three independently blinded reviewers. The
dataset retains each vote and rationale; a majority summary never replaces the
source annotations. Reviewers must not see a player identity, report status, prior
model score, or the other reviewers' votes.

A player is disputed when the reviewers do not reach the agreement rule declared in
the versioned label policy. Disputed and `indeterminate` players are excluded from
fitting, calibration, threshold selection, and headline metrics. They remain in a
separately reported challenge slice. An adjudicator may add a resolution but may not
delete or rewrite an original vote. Changing the agreement or adjudication policy
creates a new dataset version.

## Exact split policy

Splitting occurs before learned preprocessing, model fitting, calibration, or
operating-point evaluation. The split unit is the stable pseudonymous player key.
All demos, epochs, encounters, and ticks for that player belong to one split.

1. Group by player.
2. Hold out later time/server groups for evaluation wherever those fields exist.
3. Assign remaining player groups deterministically from the versioned split seed.
4. Keep generator personas, source templates, scenario variants, and derived seeds in
   one `fixtureFamilyId`; validation rejects a family present in more than one split.
5. Fit preprocessing and the base model on training players only.
6. Fit the calibrator on calibration players only; freeze the operating threshold in
   policy before the held-out split is opened.
7. Open the evaluation split once and report it without retuning.

No tick, encounter, epoch, or demo may be independently randomized across splits.
The evaluator must reject intersecting player or fixture-family IDs. Bootstrap units
are players.

The committed engineering fixture uses distinct, versioned closed-form scenario
libraries for train (`grid-7-11`), calibration (`grid-13-17`), and test
(`grid-19-23`), each with its own declared seed. Family IDs derive from the scenario
library rather than the split name, so accidental library reuse across splits is
rejected. These deliberately simple libraries exercise leakage controls; their
separation is not evidence that natural gameplay generalizes similarly.

## Coverage and distribution-shift reporting

Each release reports counts, missingness, and results - or `not evaluated` - for:

- skill proxy;
- latency/ping;
- sensitivity and input device;
- protocol and capture type;
- reconstruction quality and telemetry gaps;
- server modifications;
- map and game version;
- anomaly strength and smoothed, delayed, or randomized behavior;
- number of independent demos and encounters; and
- detector signal family.

These are gameplay-context robustness slices, not demographic fairness evaluation.
Protected demographic attributes are neither collected nor inferred. Any unobserved
slice must say `not evaluated`; it must not be merged into an “other” result that
suggests coverage.

## Known limitations

- The governed fixture distribution is designed, small, and potentially much easier
  than natural play.
- The available real corpus is homogeneous SourceTV protocol 2100 and unlabeled.
- SourceTV eye angles are server-observed, potentially quantized/interpolated, and
  are not direct mouse input.
- Licensed playback and independent framing comparisons remain pending.
- Exact hidden-target claims require licensed, versioned geometry that is not
  currently available.
- Fixture calibration does not transfer a false-positive rate, predictive value, or
  probability interpretation to real players.

## Permitted claims

The dataset may support claims that a deterministic pipeline and a predeclared
policy behave as specified on this exact controlled fixture. All broader empirical
claims require a consented, representative, player-separated evaluation and the
release gates in the operating-policy ADR.
