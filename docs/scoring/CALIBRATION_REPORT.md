# Sprint 3 calibration report

- Status: controlled-fixture evaluation complete; not population validation
- Evaluation scope: controlled fixture only
- External reference validation: pending
- Result artifact: `packages/scoring/models/c5cf711d8d7d6d12fce99e38c9bea1e991f2faa2d8fcec48e26a63c0d73ee48b.calibration.json`

This document freezes how the controlled-fixture evaluation is judged. It must not
be edited after held-out results are opened merely to make a run pass. Generated
values, exact artifact hashes, and command output belong in a reproducible result
artifact linked from this report.

## Preregistered evaluation design

- Unit of splitting, resampling, and error accounting: player.
- Split isolation: player and fixture family; later time/server groups are held out
  where available.
- Training split: model and learned preprocessing only.
- Calibration split: calibrator only; the `0.5` operating threshold is fixed in the
  versioned policy before evaluation.
- Evaluation split: opened once; no refitting, recalibration, threshold tuning, or
  feature selection.
- Reliability bins: ten fixed-width bins on `[0, 1]`, declared before evaluation.
- Intervals: player-level bootstrap intervals with method, repetitions, and seed
  recorded in the generated artifact.

The evaluator must fail closed on split overlap, missing provenance, an unbound
dataset/model/config hash, unsupported labels, or player counts below the versioned
minimum-support configuration.

## Predeclared controlled-fixture operating budget

The research operating point uses the predeclared `0.5` threshold. It passes only
when held-out results meet both:

- no more than **50 false positives per 1,000 controlled-negative fixture players**;
  and
- recall of at least **0.60** for eligible review-worthy controlled-fixture players.

The held-out report must show counts, denominators, point values, and player-level
95% intervals. Passing this budget demonstrates only a useful controlled-fixture
review operating point. The interval is not a bound for real players. A production
false-positive budget remains unset until representative consented validation and
shadow evaluation exist.

## Predeclared calibration gate

A calibrated numeric review priority is supported only when all of these hold on the
held-out controlled fixture:

1. minimum player support in both eligible labels passes the frozen configuration;
2. Brier score is lower than the constant-prevalence predictor's Brier score;
3. expected calibration error over the ten fixed-width bins is at most `0.10`;
4. no supported reliability bin has an absolute calibration gap above `0.20`; and
5. the predeclared operating budget passes.

Unsupported bins are reported with their counts; they are not dropped to improve the
metric. If any gate fails, the model status is `ranked-evidence-only`. Output then
contains ordered evidence, contributions, quality, limitations, and counterevidence,
but the score contract structurally omits numeric priority and probability fields.
`null`, zero, a hidden field, or an “uncalibrated probability” is not an acceptable
substitute.

## Generated controlled-fixture result

The frozen command `pnpm scoring:evaluate` evaluated 40 held-out invented players
(20 per controlled label) from a 120-player generated fixture. It produced model
bundle `a267f1a8a5c7e17eacf3e4ba4f17de9dd6b2ef99a77447a27c9fa14a97ceb010`
and report `c5cf711d8d7d6d12fce99e38c9bea1e991f2faa2d8fcec48e26a63c0d73ee48b`.
The held-out controlled result was 20 true positives, 20 true negatives, no errors,
0 false positives per 1,000, recall/precision 1.0, Brier
`0.0000012150881047034239` versus constant-prevalence Brier `0.25`, ECE
`0.0005192108745456989`, and maximum supported-bin gap
`0.000759951608058751`. The predeclared controlled-fixture operating and
calibration gates passed.

This near-perfect result is expected from a deliberately separable synthetic
engineering fixture. It proves determinism, split isolation, metrics, artifact
binding, and policy behavior - not difficulty representative of natural gameplay.
The generated report is authoritative for complete reliability bins, bootstrap
intervals, PR points, assumed-prevalence sensitivity, and explicitly unevaluated
slices.

## Required generated results

The reproducible evaluator must populate:

| Result                                    | Required reporting                                       | Status |
| ----------------------------------------- | -------------------------------------------------------- | ------ |
| Dataset/split/config/model/bundle digests | Full SHA-256 and versions                                | passed |
| Split composition                         | Players by controlled label and split                    | passed |
| Brier and constant-prevalence Brier       | Point values and player-level intervals                  | passed |
| Log loss                                  | Point value                                              | passed |
| Reliability                               | Ten-bin count, mean prediction, observed rate, gap       | passed |
| Calibration error                         | ECE and maximum supported-bin gap                        | passed |
| Precision-recall                          | Curve artifact, average precision, operating point       | passed |
| False positives per 1,000                 | Count, denominator, rate, interval                       | passed |
| Recall and precision                      | Counts, denominators, values, intervals                  | passed |
| Predictive-value sensitivity              | Explicit hypothetical prevalence grid                    | passed |
| Gate result                               | `calibrated-priority` or `ranked-evidence`, with reasons | passed |
| Deterministic rerun                       | Exact command plus byte-identical artifact digest        | passed |

Predictive-value sensitivity must label every prevalence as an assumption. The
unlabeled real corpus cannot supply prevalence or predictive value.

## Required robustness and shift slices

For every slice below, report player support, label support, missingness, metrics,
and intervals, or the literal state `not evaluated`:

- high-skill proxy;
- latency/ping;
- sensitivity and input device;
- protocol and capture type;
- server modifications;
- map and game version;
- reconstruction quality and telemetry gaps;
- number of independent demos and encounters;
- detector signal family; and
- smoothed, delayed, randomized, and strength-varied controlled anomalies.

Sparse slices remain visible and cannot support a passing claim. These are
gameplay-context robustness checks. Protected demographic fairness is not evaluated
because demographic attributes are not collected or inferred.

## Unlabeled real-corpus check

The CEDAPug corpus may be used only to report inference completion, output state,
quality/missingness, feature-distribution distance, and unsupported slices. It must
not contribute to calibration, threshold selection, false-positive counts, recall,
precision, accuracy, prevalence, or fairness claims. Individual identities and raw
demo artifacts remain ignored and unreported.

## Claims excluded by this report

Even after a passing controlled-fixture run, this report does not show a cheating
probability, software attribution, real-player error rate, population calibration,
moderation suitability, demographic fairness, cross-protocol performance, parser
accuracy against licensed playback, or resistance to adaptive assistance.
