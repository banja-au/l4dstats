# Research synthesis

Research was performed on 2026-07-17. Libraries and hosted behavior must be rechecked before implementation.

> **Status note (2026-07-18):** The parser-selection discussion below records
> the earlier feasibility state and is superseded for implementation by
> [ADR 0009](decisions/0009-native-rust-demo-pipeline.md), which adopts the
> repository-owned clean-room Rust parser as the normal evidence path.

## Corpus

The provided [CEDAPug demo directory](https://cedapug.com/demos/) is an Apache-style index. A direct inspection found roughly 63,250 ZIP links at research time. Treat that count as volatile. Build pageless streaming discovery and selective fixture acquisition; do not mirror the corpus. CEDAPug describes itself as a competitive L4D2 platform and says cheating decisions currently involve community reports and stats ([site](https://cedapug.com/), [FAQ](https://cedapug.com/faq)). Access and retention still require explicit policy review.

## Source demo parsing

Source 1 demos contain an `HL2DEMO` header followed by ticked command frames. Packet payloads contain network messages; send tables describe entity fields; string tables connect user information; entity deltas rebuild state; game-event schemas are dynamic. The [Valve Source SDK 2013 repository](https://github.com/ValveSoftware/source-sdk-2013) is the canonical reference, but its [license](https://github.com/ValveSoftware/source-sdk-2013/blob/master/LICENSE) is not a permissive library license: consult it, do not copy code.

The strongest starting point found is [`saul/demofile`](https://github.com/saul/demofile): MIT licensed, Source 1, supports demo commands, network messages, data/string tables, entities and events. Its high-level model is CS:GO-specific and the repository was archived in April 2026, so WitchWatch should pin/fork the minimum decoder, isolate it, and implement L4D2 projections behind adapters. Its [format notes](https://github.com/saul/demofile/wiki/Demo-files) point to Valve's `demoinfogo` as the closest complete reference.

Alternatives do not remove the key risk. [`demoinfocs-golang`](https://github.com/markus-wa/demoinfocs-golang) is mature and fast but CS-focused. [`demoparser2`](https://github.com/LaihoE/demoparser) targets Source 2/CS2. No maintained Rust L4D2 parser was identified. At that feasibility stage, a from-scratch Rust decoder was therefore considered a fallback after a fixture gate; ADR 0009 records the later clean-room implementation decision.

Unknowns that must be measured include whether archives are POV or SourceTV; which user commands/view angles are present; protocol drift; observer versus player state; slot/user-ID churn; pauses/timescale; cvars/plugins; and custom maps. These directly constrain which detectors are valid.

## Detection science

Useful signal families are:

- **Aim dynamics:** target-relative angular error, velocity/acceleration/jerk, snap shape, correction/overshoot, acquisition and switch latency, tracking error, repeated delta patterns, and shot timing. Normalize by tick interval, weapon/recoil/spread, range, stance and target angular motion.
- **Awareness:** alignment or behavioral response toward non-visible targets, pre-aim dwell and prefire. Require an information audit for sound, gunfire, teammate knowledge, prior sighting, predictable spawns/routes, cues and common angles.
- **Engine invariants:** fire cadence/ammo/state and movement/input bounds only when the recorded fields and server configuration make them authoritative.

[BotScreen (USENIX Security 2023)](https://www.usenix.org/conference/usenixsecurity23/presentation/choi) supports abnormal aim time-series analysis. [XGuardian](https://arxiv.org/abs/2601.18068) explores explainable pitch/yaw trajectory features. Earlier [behavioral wallhack detection](https://research.tees.ac.uk/ws/files/6438470/111786.pdf) motivates hidden-opponent reactions but is weak evidence alone. [BlackMirror](https://doi.org/10.1145/3372297.3417890) explains the hidden-state basis of wallhacks but is prevention research, not validation of gaze-only accusations. [Adaptive aimbot research](https://arxiv.org/abs/2004.12183) shows that humanized assistance can evade behavioral systems.

Aggregate by encounter, not tick, so correlated samples do not become fake confidence. Begin with an interpretable logistic/empirical-Bayes or monotonic model. Split evaluation by player and time/server. Calibrate on held-out data and report reliability, Brier/log loss, precision-recall, false positives per 1,000 players, prevalence-aware predictive value and player-level intervals. [T-Cal](https://www.jmlr.org/papers/v24/22-0320.html) is relevant to testing calibration; [limited-false-positive conformal methods](https://proceedings.mlr.press/v162/fisch22a.html) may help only when their exchangeability assumptions are credible.

## UI, visualization, and operations

Use pnpm + Turborepo for the small workspace. Turbo documents its [package/task graph](https://turborepo.com/docs/core-concepts/package-and-task-graph) and [cache model](https://turborepo.com/docs/crafting-your-repository/caching). Nx becomes attractive only if inferred tasks, generators, plugins and richer affected-graph tooling justify its extra machinery ([task running](https://nx.dev/docs/features/run-tasks)). Native/engine inputs and outputs must be declared explicitly to avoid incorrect cache hits.

React, Vite and Tailwind support the workbench. Add TanStack Query/Table when real API state exists ([Query overview](https://tanstack.com/query/latest/docs/framework/react/overview)). Build a custom canonical tick/time transform and Canvas/SVG timeline. Start the tactical replay in Canvas 2D; only adopt PixiJS after profiling. Pixi recommends production WebGL while WebGPU remains inconsistent ([rendering guide](https://pixijs.download/dev/docs/rendering.html)). Multi-floor game maps need explicit layers rather than geographic map tooling.

`.dem` is not video. Browser 2D/3D scenes are analytical reconstructions. Authentic clips require a separate worker running compatible licensed game binaries/assets and encoding captures; provenance must include game build and POV. Browser media can synchronize via [`HTMLMediaElement.currentTime`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime).

Start local-first with SQLite plus content-addressed files and a persistent in-process job table. Move to PostgreSQL/S3-compatible storage and BullMQ only after measured multi-worker demand. Jobs remain idempotent by demo hash plus engine/config version. Use range queries and downsampling; never ship a whole parsed demo to React.

## Product and ethics

The strongest conclusion is a constraint: behavior can prioritize review but cannot establish software use by itself. The UI must separate suspicion from data quality, expose counterevidence, preserve exact source ticks and versions, require human review, support correction/appeal, and avoid public naming or automatic punishment. Ground truth comes from consented clean sessions, controlled known configurations and blinded expert review - not reports or high skill.
