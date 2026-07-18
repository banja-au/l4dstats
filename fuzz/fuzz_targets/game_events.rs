#![no_main]
use demo_source1_native::game_events::{EventLimits, GameEventDecoder, decode_event_list};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let data = &data[..data.len().min(65_536)];
    let bits = data.len().saturating_mul(8);
    let count = data.first().map_or(0, |v| usize::from(*v % 33));
    let limits = EventLimits {
        max_events: 32,
        max_fields_per_event: 32,
        max_string_bytes: 1_024,
        max_message_bits: 524_288,
        max_total_schema_bytes: 32_768,
    };
    let _ = decode_event_list(data, bits, count, limits);
    let mut decoder = GameEventDecoder::default();
    let _ = decoder.register(data, bits, count);
    let _ = decoder.decode(data, bits);
});
