# ADR 0002: Scores are calibrated review priorities

- Status: accepted
- Date: 2026-07-17

## Decision

Expose an optional calibrated review-priority estimate, separate data quality, independent encounter count, and categorical label. Never represent the estimate as proof or connect it to automatic enforcement.

## Consequences

Aggregation occurs tick → encounter → demo → player. Training and evaluation split by player and time/server. The UI must show contributions, uncertainty, counterevidence, strongest benign explanations, and precise source ticks. Insufficient data yields no numeric estimate.
