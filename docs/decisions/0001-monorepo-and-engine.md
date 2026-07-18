# ADR 0001: Turborepo with a replaceable TypeScript engine

- Status: accepted for feasibility phase
- Date: 2026-07-17

The initial TypeScript parser choice recorded here is superseded by
[ADR 0009](0009-native-rust-demo-pipeline.md). The stable CLI/engine boundary
remains in force.

## Decision

Use pnpm and Turborepo. Begin the Source 1 feasibility spike in TypeScript behind a versioned CLI/NDJSON boundary, adapting only the required low-level pieces of a pinned MIT-licensed `demofile` fork if validation permits.

## Rationale

Turborepo supplies the small task graph this repository needs. TypeScript minimizes integration cost during protocol discovery and has the strongest plausible Source 1 starting point found. Rust has no credible maintained L4D2 parser candidate and a from-scratch implementation would dominate the schedule.

## Guardrail

The high-level library is CS:GO-oriented and was archived in April 2026. Sprint 1 is a hard gate, not an endorsement. L4D2 assumptions stay behind schema/projection interfaces. If real fixtures fail, record an ADR for a narrow decoder, potentially Rust.
