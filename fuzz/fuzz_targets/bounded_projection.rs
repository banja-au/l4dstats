#![no_main]
use demo_source1_native::{
    artifact::{ArtifactLimits, build_compact_artifact},
    direct_wire::project_direct_compact,
    projection::{ProjectLimits, project_core_with_limits},
};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let data = &data[..data.len().min(262_144)];
    let limits = ProjectLimits { max_observations: 256, max_identity_mappings: 64, max_match_states: 64 };
    let _ = project_core_with_limits(data, b"synthetic-fuzz-key", limits);
    let _ = project_direct_compact(data, b"synthetic-fuzz-key", limits);
    let _ = build_compact_artifact(data, b"synthetic-fuzz-key", ArtifactLimits {
        projection: limits,
        max_raw_events: 256,
        max_required_events: 256,
        max_event_kinds: 64,
    });
});
