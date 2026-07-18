# Native parser fuzzing

These `cargo-fuzz` targets cover bounded readers, demo framing, network/table
decoding and compression, game events, stateful entities, and bounded compact
projection. Corpus files are synthetic protocol fragments only; do not add
demos or player identifiers.

Run one target with `cargo fuzz run <target> -- -max_len=262144`. Run every
bounded smoke target with:

```sh
for target in readers demo_framing network_tables_compression game_events stateful_entities bounded_projection; do
  cargo fuzz run "$target" -- -runs=100 -max_len=262144
done
```

The harness directly depends on exact-pinned `libfuzzer-sys = 0.4.13`
(Apache-2.0/MIT) and the unpublished workspace parser. Transitive dependency
licenses remain inventoried by the repository's normal dependency/SBOM review.
