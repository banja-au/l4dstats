#![no_main]
use demo_source1_native::{bit_reader::BitReader, reader::BinaryReader};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let data = &data[..data.len().min(65_536)];
    let mut binary = BinaryReader::new(data);
    let _ = binary.u8();
    let _ = binary.i32();
    let _ = binary.f32();
    let _ = binary.fixed_latin1(data.len().min(256));

    let mut bits = BitReader::new(data);
    let _ = bits.read_ubit_var();
    let _ = bits.read_signed_bits(data.first().map_or(0, |v| usize::from(*v % 33)));
    let _ = bits.read_latin1_z(256);
    let _ = BitReader::span(data, 0, data.len().saturating_mul(8));
});
