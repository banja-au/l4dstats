use crate::bit_reader::BitReader;
use std::collections::HashMap;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StringTableEntry {
    pub name: String,
    pub data: Option<Vec<u8>>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DemoStringTable {
    pub name: String,
    pub entries: Vec<StringTableEntry>,
    pub client_entries: Vec<StringTableEntry>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StringTableSnapshot {
    pub tables: Vec<DemoStringTable>,
    pub consumed_bits: usize,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserInfoIdentity {
    pub steam_id64: u64,
    pub display_name: String,
    pub user_id: i32,
    pub fake_player: bool,
    pub source_bytes: usize,
}
pub fn decode_l4d2_user_info(data: &[u8]) -> Result<UserInfoIdentity, String> {
    if data.len() < 140 {
        return Err("truncated L4D2 userinfo".into());
    }
    let steam_id64 = u64::from_be_bytes(data[0..8].try_into().expect("checked length"));
    let end = data[8..40]
        .iter()
        .position(|&v| v == 0)
        .map_or(40, |v| 8 + v);
    let display_name = String::from_utf8_lossy(&data[8..end]).trim().to_owned();
    let raw = i32::from_le_bytes(data[40..44].try_into().expect("checked length"));
    let user_id = if raw > 0xffff && raw.trailing_zeros() >= 24 {
        raw.cast_unsigned().wrapping_shr(24).cast_signed()
    } else {
        raw
    };
    Ok(UserInfoIdentity {
        steam_id64,
        display_name,
        user_id,
        fake_player: data[116] != 0,
        source_bytes: data.len(),
    })
}
#[derive(Clone, Copy, Debug)]
pub struct StringTableLimits {
    pub max_tables: usize,
    pub max_entries_per_table: usize,
    pub max_string_bytes: usize,
    pub max_entry_data_bytes: usize,
}
impl Default for StringTableLimits {
    fn default() -> Self {
        Self {
            max_tables: 255,
            max_entries_per_table: 65_535,
            max_string_bytes: 16_384,
            max_entry_data_bytes: 1_048_576,
        }
    }
}
pub fn decode_string_table_snapshot(
    payload: &[u8],
    limits: StringTableLimits,
) -> Result<StringTableSnapshot, String> {
    if limits.max_tables == 0
        || limits.max_entries_per_table == 0
        || limits.max_string_bytes == 0
        || limits.max_entry_data_bytes == 0
    {
        return Err("string table limits must be positive".into());
    }
    let mut r = BitReader::new(payload);
    let count = r.read_bits(8).map_err(text)? as usize;
    if count > limits.max_tables {
        return Err(format!(
            "string table count {count} exceeds {}",
            limits.max_tables
        ));
    }
    let mut tables = Vec::with_capacity(count);
    for _ in 0..count {
        let name = r.read_latin1_z(limits.max_string_bytes).map_err(text)?;
        let entries_count = r.read_bits(16).map_err(text)? as usize;
        let entries = read_entries(&mut r, entries_count, limits)?;
        let client_entries = if r.read_bool().map_err(text)? {
            let n = r.read_bits(16).map_err(text)? as usize;
            read_entries(&mut r, n, limits)?
        } else {
            Vec::new()
        };
        tables.push(DemoStringTable {
            name,
            entries,
            client_entries,
        });
    }
    Ok(StringTableSnapshot {
        tables,
        consumed_bits: r.bit_offset(),
    })
}
fn read_entries(
    r: &mut BitReader<'_>,
    count: usize,
    l: StringTableLimits,
) -> Result<Vec<StringTableEntry>, String> {
    if count > l.max_entries_per_table {
        return Err(format!(
            "string table entry count {count} exceeds {}",
            l.max_entries_per_table
        ));
    }
    (0..count)
        .map(|_| {
            let name = r.read_latin1_z(l.max_string_bytes).map_err(text)?;
            let data = if r.read_bool().map_err(text)? {
                let n = r.read_bits(16).map_err(text)? as usize;
                if n > l.max_entry_data_bytes {
                    return Err(format!(
                        "string table entry data {n} exceeds {}",
                        l.max_entry_data_bytes
                    ));
                }
                Some(r.read_bytes(n).map_err(text)?)
            } else {
                None
            };
            Ok(StringTableEntry { name, data })
        })
        .collect()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NetworkStringTableChange {
    pub entry_index: usize,
    pub name: Option<String>,
    pub data: Option<Vec<u8>>,
}
#[derive(Debug)]
pub struct NetworkStringTableSchema<'a> {
    pub max_entries: usize,
    pub user_data_fixed_size: bool,
    pub user_data_size_bits: Option<usize>,
    pub existing_names: Option<&'a HashMap<usize, String>>,
}
pub fn decode_network_string_table_changes(
    bytes: &[u8],
    bit_length: usize,
    entry_count: usize,
    schema: &NetworkStringTableSchema<'_>,
) -> Result<Vec<NetworkStringTableChange>, String> {
    if bit_length < 1 || bit_length > bytes.len() * 8 {
        return Err("invalid network string-table bit length".into());
    }
    if entry_count > schema.max_entries {
        return Err("invalid network string-table entry count".into());
    }
    let mut r = BitReader::span(bytes, 0, bit_length).map_err(text)?;
    r.read_bool().map_err(text)?;
    let index_bits = if schema.max_entries <= 1 {
        0
    } else {
        (usize::BITS - (schema.max_entries - 1).leading_zeros()) as usize
    };
    // Protocol substring prefixes count encoded bytes. The decoder maps every
    // Windows-1252 byte to exactly one Unicode scalar, so a char vector keeps
    // that unit without ever slicing through UTF-8 storage.
    let mut history: Vec<Vec<char>> = Vec::new();
    let mut output = Vec::with_capacity(entry_count);
    let mut last: Option<usize> = None;
    for _ in 0..entry_count {
        let index = if r.read_bool().map_err(text)? {
            last.map_or(0, |v| v + 1)
        } else {
            r.read_bits(index_bits).map_err(text)? as usize
        };
        if index >= schema.max_entries {
            let previous = last.map_or_else(|| "-1".into(), |value| value.to_string());
            return Err(format!(
                "invalid network string-table entry index {index}/{} after {previous}",
                schema.max_entries
            ));
        }
        last = Some(index);
        let name = if r.read_bool().map_err(text)? {
            if r.read_bool().map_err(text)? {
                let h = r.read_bits(5).map_err(text)? as usize;
                let prefix = r.read_bits(5).map_err(text)? as usize;
                let base = history.get(h).ok_or_else(|| {
                    format!(
                        "invalid string-table substring reference {h}/{} prefix {prefix}",
                        history.len()
                    )
                })?;
                if prefix > base.len() {
                    return Err(format!(
                        "invalid string-table substring reference {h}/{} prefix {prefix}",
                        history.len()
                    ));
                }
                let suffix = r.read_latin1_z(16_384).map_err(text)?;
                Some(
                    base[..prefix]
                        .iter()
                        .copied()
                        .chain(suffix.chars())
                        .collect(),
                )
            } else {
                Some(r.read_latin1_z(16_384).map_err(text)?)
            }
        } else {
            None
        };
        let data = if r.read_bool().map_err(text)? {
            let bits = if schema.user_data_fixed_size {
                schema
                    .user_data_size_bits
                    .ok_or("invalid string-table user data length")?
            } else {
                (r.read_bits(14).map_err(text)? as usize) * 8
            };
            if bits > 8 * 1_048_576 {
                return Err("invalid string-table user data length".into());
            }
            Some(r.read_bytes(bits.div_ceil(8)).map_err(text)?)
        } else {
            None
        };
        let resolved = name
            .as_ref()
            .or_else(|| schema.existing_names.and_then(|m| m.get(&index)));
        if let Some(value) = resolved {
            history.push(value.chars().collect());
            if history.len() > 32 {
                history.remove(0);
            }
        }
        output.push(NetworkStringTableChange {
            entry_index: index,
            name,
            data,
        });
    }
    Ok(output)
}

pub fn unwrap_l4d2_string_table_data(
    bytes: &[u8],
    compressed: bool,
    max_output_bytes: usize,
) -> Result<Vec<u8>, String> {
    if !compressed {
        return Ok(bytes.to_vec());
    }
    if bytes.len() < 8 {
        return Err("truncated compressed string table".into());
    }
    let expected = u32::from_le_bytes(bytes[..4].try_into().expect("checked length")) as usize;
    let compressed_bytes =
        u32::from_le_bytes(bytes[4..8].try_into().expect("checked length")) as usize;
    if expected > max_output_bytes || compressed_bytes > bytes.len() - 8 {
        return Err("compressed string table exceeds bounds".into());
    }
    if compressed_bytes == 0 || expected > compressed_bytes.saturating_mul(256) {
        return Err("compressed string table exceeds decompression ratio".into());
    }
    let payload = &bytes[8..8 + compressed_bytes];
    let output = if payload.starts_with(b"LZSS") {
        decode_valve_lzss(payload, max_output_bytes)?
    } else {
        let mut framed = Vec::with_capacity(compressed_bytes + 5);
        let mut remaining = expected;
        loop {
            framed.push(
                u8::try_from((remaining & 0x7f) | if remaining > 0x7f { 0x80 } else { 0 })
                    .expect("seven-bit varint byte"),
            );
            if remaining <= 0x7f {
                break;
            }
            remaining >>= 7;
        }
        framed.extend_from_slice(payload);
        snap::raw::Decoder::new()
            .decompress_vec(&framed)
            .map_err(|e| format!("invalid compressed string table: {e}"))?
    };
    if output.len() != expected {
        return Err("compressed string table size mismatch".into());
    }
    Ok(output)
}
fn decode_valve_lzss(input: &[u8], maximum: usize) -> Result<Vec<u8>, String> {
    if input.len() < 8 {
        return Err("truncated LZSS header".into());
    }
    let size = u32::from_le_bytes(input[4..8].try_into().expect("checked length")) as usize;
    if size > maximum {
        return Err("LZSS output exceeds bounds".into());
    }
    let mut output = vec![0; size];
    let (mut source, mut target, mut command, mut bit) = (8_usize, 0_usize, 0_u8, 0_u8);
    while target < size {
        if bit == 0 {
            command = *input.get(source).ok_or("truncated LZSS command")?;
            source += 1;
        }
        bit = (bit + 1) & 7;
        if command & 1 == 0 {
            output[target] = *input.get(source).ok_or("truncated LZSS literal")?;
            source += 1;
            target += 1;
        } else {
            let a = *input.get(source).ok_or("truncated LZSS back-reference")?;
            let b = *input
                .get(source + 1)
                .ok_or("truncated LZSS back-reference")?;
            source += 2;
            let position = (usize::from(a) << 4) | usize::from(b >> 4);
            let count = usize::from(b & 0x0f) + 1;
            if count == 1 {
                break;
            }
            if position >= target || target + count > size {
                return Err("invalid LZSS back-reference".into());
            }
            let copy_start = target - position - 1;
            for index in 0..count {
                let copy = copy_start + index;
                output[target] = output[copy];
                target += 1;
            }
        }
        command >>= 1;
    }
    if target != size {
        return Err("LZSS output size mismatch".into());
    }
    Ok(output)
}
#[allow(clippy::needless_pass_by_value)]
fn text(e: impl ToString) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn push_bits(output: &mut Vec<u8>, offset: &mut usize, value: u32, count: usize) {
        for bit in 0..count {
            if *offset / 8 == output.len() {
                output.push(0);
            }
            output[*offset / 8] |= (((value >> bit) & 1) as u8) << (*offset & 7);
            *offset += 1;
        }
    }
    #[test]
    fn empty_snapshot() {
        let x = decode_string_table_snapshot(&[0], StringTableLimits::default()).unwrap();
        assert!(x.tables.is_empty());
        assert_eq!(x.consumed_bits, 8);
    }
    #[test]
    fn limits_fail_before_allocation() {
        let e = decode_string_table_snapshot(
            &[1],
            StringTableLimits {
                max_tables: 1,
                ..StringTableLimits::default()
            },
        )
        .unwrap_err();
        assert!(e.contains("need"));
    }
    #[test]
    fn decodes_protocol_2100_userinfo_endianness_and_high_user_id() {
        let mut data = vec![0; 140];
        data[..8].copy_from_slice(&76_561_198_000_000_001_u64.to_be_bytes());
        data[8..13].copy_from_slice(b"Alice");
        data[40..44].copy_from_slice(&0x1100_0000_i32.to_le_bytes());
        data[116] = 1;
        let value = decode_l4d2_user_info(&data).unwrap();
        assert_eq!(value.steam_id64, 76_561_198_000_000_001);
        assert_eq!(value.display_name, "Alice");
        assert_eq!(value.user_id, 17);
        assert!(value.fake_player);
    }
    #[test]
    fn unwraps_bounded_lzss_literals() {
        let payload = [b'L', b'Z', b'S', b'S', 3, 0, 0, 0, 0, b'a', b'b', b'c'];
        let mut wrapped = vec![3, 0, 0, 0, 12, 0, 0, 0];
        wrapped.extend(payload);
        assert_eq!(
            unwrap_l4d2_string_table_data(&wrapped, true, 10).unwrap(),
            b"abc"
        );
        assert!(unwrap_l4d2_string_table_data(&wrapped, true, 2).is_err());
    }

    #[test]
    fn rejects_excessive_decompression_ratio_before_decoder_allocation() {
        let mut wrapped = vec![1, 1, 0, 0, 1, 0, 0, 0];
        wrapped.push(0);
        assert!(
            unwrap_l4d2_string_table_data(&wrapped, true, 10_000)
                .unwrap_err()
                .contains("ratio")
        );
    }

    #[test]
    fn substring_prefix_counts_protocol_bytes_not_utf8_bytes() {
        let (mut bits, mut at) = (Vec::new(), 0);
        push_bits(&mut bits, &mut at, 0, 1); // dictionary encoding disabled
        push_bits(&mut bits, &mut at, 1, 1); // sequential index 0
        push_bits(&mut bits, &mut at, 1, 1); // has name
        push_bits(&mut bits, &mut at, 0, 1); // literal name
        push_bits(&mut bits, &mut at, 0x80, 8); // one Windows-1252 byte
        push_bits(&mut bits, &mut at, 0, 8);
        push_bits(&mut bits, &mut at, 0, 1); // no data
        push_bits(&mut bits, &mut at, 1, 1); // sequential index 1
        push_bits(&mut bits, &mut at, 1, 1); // has name
        push_bits(&mut bits, &mut at, 1, 1); // substring
        push_bits(&mut bits, &mut at, 0, 5); // history entry 0
        push_bits(&mut bits, &mut at, 1, 5); // one protocol byte prefix
        push_bits(&mut bits, &mut at, u32::from(b'x'), 8);
        push_bits(&mut bits, &mut at, 0, 8);
        push_bits(&mut bits, &mut at, 0, 1); // no data
        let schema = NetworkStringTableSchema {
            max_entries: 2,
            user_data_fixed_size: false,
            user_data_size_bits: None,
            existing_names: None,
        };
        let values = decode_network_string_table_changes(&bits, at, 2, &schema).unwrap();
        assert_eq!(values[1].name.as_deref(), Some("€x"));
    }
}
