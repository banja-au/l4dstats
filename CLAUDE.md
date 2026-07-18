# CLAUDE.md

Start with `AGENTS.md`; it is authoritative. Then read `L4D2.md`, `DEMO-DATA.md`, `docs/L4DSTATS-RATING.md`, `PLAN.md`, and `docs/ARCHITECTURE.md`. `L4D2.md` is the shared game/Versus/domain reference. `DEMO-DATA.md` is the parser capability contract: update it in the same change as decoding, projection, artifact, or statistic changes, and keep unavailable data explicit. Keep the rating methodology, `packages/l4d2-rating`, and its adapters synchronized whenever rating inputs, formulas, weights, eligibility, confidence, MVP selection, or scientific claims change.

Keep this project lightweight and evidence-first. Prefer a small vertical slice over framework scaffolding. Never call a review score proof, never automate punishment, never commit demo/player data, and never hide missing telemetry. Before finishing, run the root format, typecheck, test, and build commands and state any checks you could not run.
