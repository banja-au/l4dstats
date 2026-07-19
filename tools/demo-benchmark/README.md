# Demo benchmark harness

Runs explicitly supplied demos sequentially through one release native command.
It reports wall, user/system CPU, maximum RSS and byte-throughput distributions,
with fixtures identified only by SHA-256 and byte size. Never commit demos,
benchmark outputs containing identifiers, or local command configuration.
Historical TypeScript comparisons are preserved in the sprint ledger rather
than rerun by this regression harness.

Commands are JSON argv arrays and must contain `{demo}`. They never pass through
a shell. Example:

```bash
export L4DSTATS_NATIVE_BENCH_COMMAND='["/workspace/target/release/demo-source1-stage","framing","{demo}"]'
export L4DSTATS_NATIVE_BENCH_ARTIFACT='/workspace/target/release/demo-source1-stage'
export L4DSTATS_NATIVE_BENCH_VERSION='demo-source1-native@0.1.0'
export L4DSTATS_NATIVE_BENCH_BUILD_SHA256='<64 lowercase hex characters>'
node tools/demo-benchmark/benchmark.mjs \
  --mode stage --warmups 1 --repetitions 5 \
  --max-median-wall-ms 60000 --max-median-rss-kib 1500000 \
  --min-median-throughput-bps 1000000 \
  --demo /ignored/a.dem --demo /ignored/b.dem \
  --demo /ignored/c.dem --demo /ignored/d.dem --demo /ignored/e.dem \
  > /ignored/results.json
```

`L4DSTATS_BENCH_DEMOS` may instead contain a JSON array of explicit paths.
`L4DSTATS_NATIVE_BENCH_ARTIFACT` records the exact native artifact independently
of the command used to invoke it. Stage benchmarks require an executable beneath
`target/release`; end-to-end benchmarks require the exact `.node` addon, while
the native command may legitimately begin with `node`. The artifact basename, byte
size, SHA-256, and kind are retained in benchmark provenance.
Runs have configurable wall timeout and combined stdout/stderr cap. When GNU
`/usr/bin/time` exists, child user CPU, system CPU, and maximum RSS are included;
otherwise these fields are explicitly `null`.

Threshold flags are optional. When configured, a median wall-time or RSS excess,
unavailable RSS, or median throughput shortfall fails the run. Choose thresholds
from a recorded same-host baseline; the harness does not embed machine-specific
defaults.
