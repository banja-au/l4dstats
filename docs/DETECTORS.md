# Detector cards

Sprint 2 detectors produce review windows, not verdicts or player scores. Every result contains raw features, a unit-labelled local effect, independent reconstruction quality, explanation, limitations, counterevidence, and artifact/version provenance. Missing prerequisites produce a structured skip.

## Aim dynamics `1.0.0`

- **Purpose:** surface rapid target acquisition with abrupt acceleration/jerk, low post-movement error, and correction/settling behavior.
- **Requires:** monotonic demo time, networked eye angles, player and selected-target positions; shot timing is optional and explicitly reported.
- **Features:** wrapped pitch/yaw deltas, angular speed, acceleration, jerk, acquisition time, pre/post target error, correction tracking error, and nearest-shot timing.
- **Limitations:** server/SourceTV observations are not direct mouse input; quantization, interpolation, low tick rate, sensitivity, target selection, and skilled human flicks can create similar shapes.

## Audited hidden alignment `1.0.0`

- **Purpose:** surface close alignment to a hidden target only after a complete information audit.
- **Requires:** authoritative LOS, versioned geometry, resolved dynamic occluders, target alignment, audibility state, and prior-knowledge state.
- **Skip policy:** partial/unavailable visibility never becomes “hidden.” Team voice communication is not observable and remains counterevidence.
- **Limitations:** coincidence, callouts, sound-model errors, and target-selection ambiguity remain plausible.

## Fire cadence invariant `1.0.0`

- **Purpose:** report a fire interval below an authoritative weapon-cycle bound.
- **Requires:** matching weapon identity, authoritative state/mode, shot times, cycle time, and consistent ammo transitions.
- **Limitations:** duplicated events or an incomplete weapon-mode model can mimic a violation.

## Movement invariant `1.0.0`

- **Purpose:** report observed speed above an authoritative movement-mode bound.
- **Requires:** authoritative movement mode, observed speed, and a mode-specific allowed speed.
- **Limitations:** unmodeled knockback, triggers, teleports, or temporary modifiers can explain excess speed.

## Encounters and reproducibility

Nearby windows collapse only when player epoch, detector ID/version, and config hash agree. The encounter retains every source window and exposes the strongest local effect; it does not combine detectors or compute a player score.

Run the feature explorer with:

```bash
pnpm --filter @l4dstats/cli dev detectors
pnpm --filter @l4dstats/cli dev features /workspace/apps/cli/fixtures/synthetic-aim-request.json
```

The tracked [synthetic evidence artifact](sprints/sprint-2-synthetic-evidence.json) is intentionally obvious synthetic data. Real-demo execution is also covered by a deterministic, conservative [real evidence artifact](sprints/sprint-2-real-evidence.json); external reference validation remains required before release claims.
