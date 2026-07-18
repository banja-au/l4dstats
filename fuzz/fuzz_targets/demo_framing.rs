#![no_main]
use demo_source1_native::{DecodeOptions, decode_demo};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let data = &data[..data.len().min(262_144)];
    let _ = decode_demo(data, DecodeOptions {
        max_input_bytes: 262_144,
        max_commands: 1_024,
        max_payload_bytes: 65_536,
    });
});
