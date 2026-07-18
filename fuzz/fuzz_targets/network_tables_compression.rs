#![no_main]
use demo_source1_native::{
    data_tables::decode_l4d2_data_tables,
    network::{NetworkLimits, inspect_network_payload},
    string_tables::{StringTableLimits, decode_string_table_snapshot, unwrap_l4d2_string_table_data},
};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let data = &data[..data.len().min(65_536)];
    let _ = inspect_network_payload(data, NetworkLimits {
        max_messages: 256,
        max_string_bytes: 1_024,
        max_string_table_entries: 1_024,
        max_message_data_bits: 524_288,
    });
    let _ = decode_l4d2_data_tables(data);
    let _ = decode_string_table_snapshot(data, StringTableLimits {
        max_tables: 32,
        max_entries_per_table: 1_024,
        max_string_bytes: 1_024,
        max_entry_data_bytes: 65_536,
    });
    let _ = unwrap_l4d2_string_table_data(data, true, 65_536);
});
