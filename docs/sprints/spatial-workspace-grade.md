# Spatial workspace design grade

## Target

Build a spatial analysis workspace with the direct-manipulation quality and
visual restraint of Google Maps or Apple Maps while preserving L4DStats'
evidence and missing-data rules. A grade is accepted only when supported by
source inspection, focused tests, and a rendered-browser review.

## Rubric

Each metric is scored from 0 to 5. The aggregate is the unweighted mean so a
visually attractive surface cannot conceal weak evidence handling or unusable
interaction.

| Metric                   | 2026-07-19 baseline | Evidence                                                                                                |
| ------------------------ | ------------------: | ------------------------------------------------------------------------------------------------------- |
| Visual polish            |                 2.5 | Dense triangle strokes, nested borders, and a debug-mesh appearance dominate the map.                   |
| Direct manipulation      |                 1.6 | Fixed centered 1x/1.5x/2x zoom; no pan, wheel/pinch zoom, fit, or hover.                                |
| Information architecture |                 2.6 | Map selector and event list exist, but no layer hierarchy or inspector workspace.                       |
| Analytical depth         |                 2.3 | Positioned events and height slice exist; no density, clustering, time brush, or cohort filters.        |
| Side/half comparison     |                 1.2 | No Team A/B, role, half, or synchronized comparison controls.                                           |
| Accessibility            |                 2.8 | Canvas label and textual event list exist; controls and legend are incomplete and color-heavy.          |
| Performance              |                 2.4 | Every redraw walks and strokes every triangle; no cached base layer or spatial index.                   |
| Evidence honesty         |                 4.4 | BSP provenance and missing geometry are explicit; sparse event points are not mislabelled as occupancy. |
| **Aggregate**            |            **2.48** | **Initial code audit; rendered re-grade pending.**                                                      |

## Re-grade 1 — direct manipulation and real mesh

Strict source and rendered-browser review against the same rubric, using the
47,359-triangle `c5m2_park` artifact, scored **3.53/5.00**. Desktop and mobile
journeys render successfully. The slice adds cursor-anchored wheel zoom, drag,
pinch, keyboard pan/zoom/event traversal, fit, expansion, selection, cached mesh
paths, event-density display modes, cohort/time/height controls, and an explicit
Team A/B comparison surface.

The grade remains below target because the map lacks provenance-backed semantic
landmarks, density is event glow rather than a normalized analytical surface,
comparison needs stronger denominators and a split/difference view, interaction
performance lacks a measured budget, and the inspector/layer system is not yet
Maps-quality. The UI explicitly calls density “positioned timeline events, not
player occupancy”; that limitation must remain until pose exposure is projected.

## Acceptance evidence for 4.9

- Cursor-anchored wheel zoom, drag pan, touch/pinch, fit/reset, keyboard controls,
  and stable selection.
- Flat cartographic base with progressive detail, complete legend, responsive
  layer rail, inspector, and timeline-range interaction.
- Honest positioned-event density plus event, player, class, half, role, and
  roster filters with denominators and unknown states.
- Team A/B x Survivor/Infected comparison that preserves side-swap semantics.
- Derived landmark labels with explicit demo/BSP/NAV provenance.
- Bounded rendering cost and focused interaction/accessibility tests.
- Browser screenshots at desktop and mobile sizes reviewed against this rubric.

## Re-grade 2 — current strict spatial + Story audit

Fresh desktop/mobile browser renders and source inspection on 2026-07-19 score
the spatial workspace **3.97/5.00** and Story/Timeline **3.25/5.00**, for a
combined working aggregate of **3.61/5.00**. This is the authoritative pre-pass
grade before the round-structure, mobile Story, accessibility, and dense-event
performance work below.

Spatial strengths are evidence honesty (4.7), direct manipulation (4.2), and a
normalized analytical layer. Its largest remaining gaps are semantic
cartography, realistic dense-event validation, synchronized comparison, and
measured frame-time bounds. Story's largest gaps are flat round structure, a
desktop hit-card grammar squeezed onto mobile, incomplete tab semantics, and an
unmeasured eager timeline DOM. The audit also found that an absent round boundary
was displayed as Round 1; this is now explicitly `Unsegmented` instead.

Changes begun after this grade include sticky observed-round dividers, hit
numbering that resets only at an observed `round_start`, a mobile horizontal
filter rail, a mobile-native stacked hit summary, complete tab relationships and
arrow navigation, a screen-space marker index, and a deterministic 2,000-point
candidate budget. These changes require a fresh rendered re-grade and do not yet
constitute the 4.9 acceptance result.
