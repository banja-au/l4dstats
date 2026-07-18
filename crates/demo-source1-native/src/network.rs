use crate::bit_reader::{BitReadError, BitReader};
use std::fmt;

pub const SOURCE1_MESSAGE_TYPE_BITS: usize = 6;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BoundaryStatus {
    DecodedBoundary,
    Unsupported,
    Truncated,
    Malformed,
}
impl BoundaryStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DecodedBoundary => "decoded-boundary",
            Self::Unsupported => "unsupported",
            Self::Truncated => "truncated",
            Self::Malformed => "malformed",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Envelope {
    Tick {
        engine_tick: u32,
    },
    ServerInfo {
        network_protocol: u32,
        server_count: u32,
        is_source_tv: bool,
        dedicated: bool,
        max_server_classes: u32,
        player_count: u32,
        max_clients: u32,
        tick_interval_seconds: f32,
        platform_code: u32,
    },
    CreateStringTable {
        table_name: String,
        max_entries: u32,
        entry_count: u32,
        data_bit_length: u32,
        user_data_fixed_size: bool,
        user_data_size: Option<u32>,
        user_data_size_bits: Option<u32>,
        is_filenames: bool,
        flags: u32,
        data_compressed: bool,
        data_start_bit: usize,
    },
    UpdateStringTable {
        table_id: u32,
        changed_entries: u32,
        data_bit_length: u32,
        data_start_bit: usize,
    },
    PacketEntities {
        max_entries: u32,
        is_delta: bool,
        delta_from: Option<u32>,
        baseline: u32,
        updated_entries: u32,
        data_bit_length: u32,
        update_baseline: bool,
        data_start_bit: usize,
    },
    GameEvent {
        data_bit_length: u32,
        data_start_bit: usize,
    },
    GameEventList {
        event_count: u32,
        data_bit_length: u32,
        data_start_bit: usize,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct NetworkMessageBoundary {
    pub id: u32,
    pub name: String,
    pub start_bit: usize,
    pub end_bit: Option<usize>,
    pub status: BoundaryStatus,
    pub envelope: Option<Envelope>,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct NetworkPayloadInspection {
    pub bit_length: usize,
    pub consumed_bits: usize,
    pub trailing_padding_bits: usize,
    pub messages: Vec<NetworkMessageBoundary>,
    pub complete: bool,
}
#[derive(Clone, Copy, Debug)]
pub struct NetworkLimits {
    pub max_messages: usize,
    pub max_string_bytes: usize,
    pub max_string_table_entries: usize,
    pub max_message_data_bits: usize,
}
impl Default for NetworkLimits {
    fn default() -> Self {
        Self {
            max_messages: 65_536,
            max_string_bytes: 16_384,
            max_string_table_entries: 65_535,
            max_message_data_bits: 8 * 1_048_576,
        }
    }
}

pub fn inspect_network_payload(
    bytes: &[u8],
    limits: NetworkLimits,
) -> Result<NetworkPayloadInspection, String> {
    if limits.max_messages == 0
        || limits.max_string_bytes == 0
        || limits.max_string_table_entries == 0
        || limits.max_message_data_bits == 0
    {
        return Err("network limits must be positive".into());
    }
    let mut r = BitReader::new(bytes);
    let mut messages = Vec::new();
    while r.remaining_bits() >= 6 {
        if messages.len() >= limits.max_messages {
            return Err("network message limit exceeded".into());
        }
        if r.remaining_bits() <= 7 && remaining_zero(bytes, r.bit_offset()) {
            break;
        }
        let start = r.bit_offset();
        let id = r.read_bits(6).map_err(|e| e.to_string())?;
        let name = message_name(id);
        match skip_known(&mut r, id, limits) {
            Ok(KnownMessage::Decoded(envelope)) => messages.push(NetworkMessageBoundary {
                id,
                name,
                start_bit: start,
                end_bit: Some(r.bit_offset()),
                status: BoundaryStatus::DecodedBoundary,
                envelope,
                reason: None,
            }),
            Ok(KnownMessage::Unsupported) => {
                messages.push(NetworkMessageBoundary {
                    id,
                    name,
                    start_bit: start,
                    end_bit: None,
                    status: BoundaryStatus::Unsupported,
                    envelope: None,
                    reason: None,
                });
                return Ok(finish(bytes, &r, messages, false));
            }
            Err(error) => {
                messages.push(NetworkMessageBoundary {
                    id,
                    name,
                    start_bit: start,
                    end_bit: None,
                    status: if error.is_truncated() {
                        BoundaryStatus::Truncated
                    } else {
                        BoundaryStatus::Malformed
                    },
                    envelope: None,
                    reason: Some(error.to_string()),
                });
                return Ok(finish(bytes, &r, messages, false));
            }
        }
    }
    Ok(finish(bytes, &r, messages, true))
}
pub fn extract_network_bits(
    bytes: &[u8],
    start_bit: usize,
    bit_length: usize,
) -> Result<Vec<u8>, String> {
    let end = start_bit
        .checked_add(bit_length)
        .ok_or("network bit range is outside payload")?;
    if end > bytes.len() * 8 {
        return Err("network bit range is outside payload".into());
    }
    let mut out = vec![0; bit_length.div_ceil(8)];
    for bit in 0..bit_length {
        let source = start_bit + bit;
        out[bit >> 3] |= ((bytes[source >> 3] >> (source & 7)) & 1) << (bit & 7);
    }
    Ok(out)
}

enum KnownMessage {
    Decoded(Option<Envelope>),
    Unsupported,
}

#[derive(Debug)]
enum SkipError {
    Bits(BitReadError),
    Malformed(String),
}
impl SkipError {
    const fn is_truncated(&self) -> bool {
        matches!(self, Self::Bits(_))
    }
}
impl fmt::Display for SkipError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bits(error) => error.fmt(f),
            Self::Malformed(message) => f.write_str(message),
        }
    }
}
impl From<BitReadError> for SkipError {
    fn from(value: BitReadError) -> Self {
        Self::Bits(value)
    }
}

#[allow(clippy::too_many_lines)]
fn skip_known(r: &mut BitReader<'_>, id: u32, l: NetworkLimits) -> Result<KnownMessage, SkipError> {
    let envelope = match id {
        0 => None,
        2 => {
            r.skip_bits(32)?;
            r.read_latin1_z(l.max_string_bytes)?;
            r.skip_bits(2)?;
            None
        }
        1 | 5 | 16 => {
            r.read_latin1_z(l.max_string_bytes)?;
            None
        }
        3 | 11 => {
            r.skip_bits(1)?;
            None
        }
        4 => {
            let engine_tick = r.read_bits(32)?;
            r.skip_bits(32)?;
            Some(Envelope::Tick { engine_tick })
        }
        6 => {
            let count = r.read_bits(8)?;
            for _ in 0..count {
                r.read_latin1_z(l.max_string_bytes)?;
                r.read_latin1_z(l.max_string_bytes)?;
            }
            None
        }
        7 => {
            r.skip_bits(8 + 32 + 32)?;
            let n = r.read_bits(32)? as usize;
            bounded(
                n.saturating_mul(8),
                l.max_message_data_bits,
                "player ID bits",
            )?;
            r.skip_bits(n.saturating_mul(8))?;
            let n = r.read_bits(32)? as usize;
            bounded(
                n.saturating_mul(8),
                l.max_message_data_bits,
                "map name bits",
            )?;
            r.skip_bits(n.saturating_mul(8))?;
            None
        }
        8 => {
            let network_protocol = r.read_bits(16)?;
            let server_count = r.read_bits(32)?;
            let is_source_tv = r.read_bool()?;
            let dedicated = r.read_bool()?;
            r.skip_bits(32 + 32 + 1)?;
            let max_server_classes = r.read_bits(16)?;
            r.skip_bits(32)?;
            let player_count = r.read_bits(8)?;
            let max_clients = r.read_bits(8)?;
            let tick_interval_seconds = r.read_f32()?;
            let platform_code = r.read_bits(8)?;
            for _ in 0..6 {
                r.read_latin1_z(l.max_string_bytes)?;
            }
            Some(Envelope::ServerInfo {
                network_protocol,
                server_count,
                is_source_tv,
                dedicated,
                max_server_classes,
                player_count,
                max_clients,
                tick_interval_seconds,
                platform_code,
            })
        }
        9 => {
            r.skip_bits(1)?;
            let n = r.read_bits(16)? as usize;
            r.skip_bits(n)?;
            None
        }
        10 => {
            let count = r.read_bits(16)?;
            if !r.read_bool()? {
                let bits = if count <= 1 {
                    0
                } else {
                    (32 - (count - 1).leading_zeros()) as usize
                };
                for _ in 0..count {
                    r.skip_bits(bits)?;
                    r.read_latin1_z(l.max_string_bytes)?;
                    r.read_latin1_z(l.max_string_bytes)?;
                }
            }
            None
        }
        12 => {
            let table_name = r.read_latin1_z(l.max_string_bytes)?;
            let max = r.read_bits(16)?;
            if max == 0 || max as usize > l.max_string_table_entries {
                return Err(SkipError::Malformed(format!(
                    "string table max entries {max} is invalid"
                )));
            }
            let bits = (32 - max.leading_zeros()) as usize;
            let count = r.read_bits(bits)?;
            if count > max {
                return Err(SkipError::Malformed(format!(
                    "string table entry count {count} exceeds {max}"
                )));
            }
            let n = r.read_bits(21)? as usize;
            bounded(n, l.max_message_data_bits, "string table data bits")?;
            let user_data_fixed_size = r.read_bool()?;
            let (user_data_size, user_data_size_bits) = if user_data_fixed_size {
                (Some(r.read_bits(12)?), Some(r.read_bits(4)?))
            } else {
                (None, None)
            };
            let flags = r.read_bits(2)?;
            let data_start_bit = r.bit_offset();
            r.skip_bits(n)?;
            Some(Envelope::CreateStringTable {
                table_name,
                max_entries: max,
                entry_count: count,
                data_bit_length: u32::try_from(n).expect("21-bit value"),
                user_data_fixed_size,
                user_data_size,
                user_data_size_bits,
                is_filenames: flags & 2 != 0,
                flags,
                data_compressed: flags & 1 != 0,
                data_start_bit,
            })
        }
        13 => {
            let table_id = r.read_bits(5)?;
            let changed_entries = if r.read_bool()? { r.read_bits(16)? } else { 1 };
            let n = r.read_bits(20)? as usize;
            bounded(n, l.max_message_data_bits, "string table update bits")?;
            let data_start_bit = r.bit_offset();
            r.skip_bits(n)?;
            Some(Envelope::UpdateStringTable {
                table_id,
                changed_entries,
                data_bit_length: u32::try_from(n).expect("20-bit value"),
                data_start_bit,
            })
        }
        14 => {
            r.read_latin1_z(l.max_string_bytes)?;
            if r.read_bits(8)? == 255 {
                r.skip_bits(16)?;
            }
            None
        }
        15 => {
            r.skip_bits(16)?;
            let n = r.read_bits(16)? as usize;
            r.skip_bits(4 + n)?;
            None
        }
        17 => {
            let reliable = r.read_bool()?;
            if !reliable {
                r.skip_bits(8)?;
            }
            let n = r.read_bits(if reliable { 8 } else { 16 })? as usize;
            r.skip_bits(n)?;
            None
        }
        18 => {
            r.skip_bits(11)?;
            None
        }
        19 => {
            r.skip_bits(49)?;
            None
        }
        20 => {
            r.skip_bits(48)?;
            None
        }
        21 => {
            let axes = [r.read_bool()?, r.read_bool()?, r.read_bool()?];
            for present in axes {
                if present {
                    skip_bit_coord(r)?;
                }
            }
            r.skip_bits(9)?;
            if r.read_bool()? {
                r.skip_bits(23)?;
            }
            r.skip_bits(1)?;
            None
        }
        22 => {
            r.skip_bits(13)?;
            None
        }
        23 => {
            r.skip_bits(8)?;
            let n = r.read_bits(11)? as usize;
            r.skip_bits(n)?;
            None
        }
        24 => {
            r.skip_bits(20)?;
            let n = r.read_bits(11)? as usize;
            r.skip_bits(n)?;
            None
        }
        25 => {
            let n = r.read_bits(11)?;
            bounded(n as usize, l.max_message_data_bits, "game event data bits")?;
            let start = r.bit_offset();
            r.skip_bits(n as usize)?;
            Some(Envelope::GameEvent {
                data_bit_length: n,
                data_start_bit: start,
            })
        }
        26 => {
            let max_entries = r.read_bits(11)?;
            let is_delta = r.read_bool()?;
            let delta_from = if is_delta {
                Some(r.read_bits(32)?)
            } else {
                None
            };
            let baseline = r.read_bits(1)?;
            let updated_entries = r.read_bits(11)?;
            let n = r.read_bits(20)?;
            let update_baseline = r.read_bool()?;
            bounded(
                n as usize,
                l.max_message_data_bits,
                "packet entity data bits",
            )?;
            let start = r.bit_offset();
            r.skip_bits(n as usize)?;
            Some(Envelope::PacketEntities {
                max_entries,
                is_delta,
                delta_from,
                baseline,
                updated_entries,
                data_bit_length: n,
                update_baseline,
                data_start_bit: start,
            })
        }
        27 => {
            r.skip_bits(8)?;
            let n = r.read_bits(18)? as usize;
            r.skip_bits(n)?;
            None
        }
        28 => {
            r.skip_bits(15)?;
            None
        }
        29 => {
            r.skip_bits(16)?;
            let n = r.read_bits(32)? as usize;
            r.skip_bits(n)?;
            None
        }
        30 => {
            let event_count = r.read_bits(9)?;
            let n = r.read_bits(20)?;
            bounded(
                n as usize,
                l.max_message_data_bits,
                "game event list data bits",
            )?;
            let start = r.bit_offset();
            r.skip_bits(n as usize)?;
            Some(Envelope::GameEventList {
                event_count,
                data_bit_length: n,
                data_start_bit: start,
            })
        }
        31 => {
            r.skip_bits(32)?;
            r.read_latin1_z(l.max_string_bytes)?;
            None
        }
        32 => {
            let n = (r.read_bits(32)? as usize).saturating_mul(8);
            bounded(n, l.max_message_data_bits, "key-values bits")?;
            r.skip_bits(n)?;
            None
        }
        33 => {
            let n = r.read_bits(32)? as usize;
            bounded(n, l.max_message_data_bits, "paintmap bits")?;
            r.skip_bits(n)?;
            None
        }
        _ => return Ok(KnownMessage::Unsupported),
    };
    Ok(KnownMessage::Decoded(envelope))
}
fn bounded(value: usize, limit: usize, label: &str) -> Result<(), SkipError> {
    if value > limit {
        Err(SkipError::Malformed(format!(
            "{label} {value} exceeds {limit}"
        )))
    } else {
        Ok(())
    }
}
fn skip_bit_coord(r: &mut BitReader<'_>) -> Result<(), SkipError> {
    let integer = r.read_bool()?;
    let fraction = r.read_bool()?;
    if !integer && !fraction {
        return Ok(());
    }
    r.skip_bits(1)?;
    if integer {
        r.skip_bits(14)?;
    }
    if fraction {
        r.skip_bits(5)?;
    }
    Ok(())
}
fn finish(
    bytes: &[u8],
    r: &BitReader<'_>,
    messages: Vec<NetworkMessageBoundary>,
    complete: bool,
) -> NetworkPayloadInspection {
    NetworkPayloadInspection {
        bit_length: bytes.len() * 8,
        consumed_bits: r.bit_offset(),
        trailing_padding_bits: if complete { r.remaining_bits() } else { 0 },
        messages,
        complete,
    }
}
fn remaining_zero(bytes: &[u8], start: usize) -> bool {
    (start..bytes.len() * 8).all(|bit| ((bytes[bit >> 3] >> (bit & 7)) & 1) == 0)
}
fn message_name(id: u32) -> String {
    const NAMES: [&str; 34] = [
        "net_NOP",
        "net_Disconnect",
        "net_File",
        "net_SplitScreenUser",
        "net_Tick",
        "net_StringCmd",
        "net_SetConVar",
        "net_SignonState",
        "svc_ServerInfo",
        "svc_SendTable",
        "svc_ClassInfo",
        "svc_SetPause",
        "svc_CreateStringTable",
        "svc_UpdateStringTable",
        "svc_VoiceInit",
        "svc_VoiceData",
        "svc_Print",
        "svc_Sounds",
        "svc_SetView",
        "svc_FixAngle",
        "svc_CrosshairAngle",
        "svc_BSPDecal",
        "svc_SplitScreen",
        "svc_UserMessage",
        "svc_EntityMessage",
        "svc_GameEvent",
        "svc_PacketEntities",
        "svc_TempEntities",
        "svc_Prefetch",
        "svc_Menu",
        "svc_GameEventList",
        "svc_GetCvarValue",
        "svc_CmdKeyValues",
        "svc_PaintmapData",
    ];
    NAMES
        .get(id as usize)
        .map_or_else(|| format!("unknown_{id}"), |v| (*v).into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bits(fields: &[(u64, usize)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut at = 0;
        for &(v, n) in fields {
            for bit in 0..n {
                if at / 8 == out.len() {
                    out.push(0);
                }
                out[at / 8] |= (((v >> bit) & 1) as u8) << (at & 7);
                at += 1;
            }
        }
        out
    }
    #[test]
    fn tick_and_padding() {
        let b = bits(&[(4, 6), (42, 32), (0, 16), (0, 16)]);
        let x = inspect_network_payload(&b, NetworkLimits::default()).unwrap();
        assert!(x.complete);
        assert!(matches!(
            x.messages[0].envelope,
            Some(Envelope::Tick { engine_tick: 42 })
        ));
    }
    #[test]
    fn fails_closed_on_unsupported() {
        let b = bits(&[(63, 6), (4, 6)]);
        let x = inspect_network_payload(&b, NetworkLimits::default()).unwrap();
        assert!(!x.complete);
        assert_eq!(x.messages.len(), 1);
        assert_eq!(x.messages[0].status, BoundaryStatus::Unsupported);
    }
}
