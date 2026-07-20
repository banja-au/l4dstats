# AGENTS.md

Instructions apply to the entire repository.

## Mission

Build a reproducible L4D2 demo review aid. Optimize for evidence quality, simple code, and reviewer comprehension, not impressive-looking certainty.

## Non-negotiables

1. Never label a player a cheater. Use `review priority`, `insufficient data`, or `highly anomalous`.
2. Never add automated enforcement, public accusation, or threshold-based banning.
3. Never commit demos, archives, player identifiers, databases, source map assets (including BSPs, textures, models, sounds, or entities), clips, or secrets. Bounded derived geometry JSON may be committed only with provenance and catalog lineage under the policy recorded in ADR 0007.
4. Preserve demo hash, source, parser/detector/model versions, config, map asset version, and derivation lineage.
5. Unknown or missing telemetry must be explicit. Do not impute zeros or manufacture precision.
6. Remote ingestion requires an allowlist, time/size limits, archive traversal and decompression-bomb defenses, hashing, and idempotency.
7. Source SDK code is a reference with a restrictive license. Do not copy it. Any third-party parser must be pinned, isolated, and license documented.

## Working method

- Read `README.md`, `L4D2.md`, `DEMO-DATA.md`, `docs/L4DSTATS-RATING.md`, `docs/ARCHITECTURE.md`, and the relevant ADR before changing architecture. Treat `L4D2.md` as the shared Versus/domain model. Treat `DEMO-DATA.md` as the source of truth for extracted, derived, and unavailable demo data; update it with every parsing/statistics change and never render unavailable data as zero. Keep the rating methodology, `packages/l4d2-rating`, and its adapters synchronized whenever rating inputs, formulas, weights, eligibility, confidence, MVP selection, or scientific claims change.
- Work one sprint outcome or smaller vertical slice at a time. Do not create speculative packages.
- Prefer pure functions and narrow interfaces. Detector logic must not know about HTTP, storage, or React.
- Keep the canonical observation and evidence contracts versioned and append-compatible.
- Use tick as the primary coordinate; store derived demo time separately. Never assume constant wall-clock time through pauses or skips.
- Key a player by stable Steam identity plus demo-local connection epoch, not slot or user ID alone.
- Document meaningful decisions in `docs/decisions/`.

## Definition of done

- The requested outcome and any affected contract or ADR criteria are met with evidence.
- `pnpm format:check && pnpm check && pnpm test && pnpm build` pass.
- New behavior has tests at the cheapest useful layer.
- Parser changes include golden/corrupt fixtures; detectors include benign and anomalous cases.
- User-facing findings include explanation, limitations, strongest counterevidence, and a tick deep link.
- Documentation and example contracts match the implementation.

## Agent swarm protocol

For sprint-scale execution, assign independent tracks only where files and decisions do not overlap: protocol research/fixtures, detector experiments, UI visualization, and verification. One lead owns contract changes and synthesis. Agents must report sources, assumptions, changed files, commands run, and unresolved risks. Never let multiple agents independently redesign canonical contracts.
