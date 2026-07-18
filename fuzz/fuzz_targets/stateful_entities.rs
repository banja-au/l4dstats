#![no_main]
use demo_source1_native::{
    data_tables::{FlattenedServerClass, ServerClassSchema},
    entities::{EntityReconstructor, decode_packet_entity_data},
};
use libfuzzer_sys::fuzz_target;
use std::collections::HashMap;

fuzz_target!(|data: &[u8]| {
    let data = &data[..data.len().min(65_536)];
    let classes = vec![FlattenedServerClass {
        schema: ServerClassSchema { data_table_id: 0, class_name: "Synthetic".into(), data_table_name: "DT_Synthetic".into() },
        props: Vec::new(),
    }];
    let updated = data.first().map_or(0, |v| usize::from(*v % 33));
    let updates = decode_packet_entity_data(data, data.len() * 8, updated, &classes, &HashMap::new(), false, false, 64);
    if let (Ok(updates), Ok(mut state)) = (updates, EntityReconstructor::new(64, 4, HashMap::new())) {
        let _ = state.apply(1, false, None, 0, false, 64, &updates, &classes);
    }
});
