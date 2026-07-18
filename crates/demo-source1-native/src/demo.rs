use crate::reader::{BinaryReadError, BinaryReader};
use serde::Serialize;
use std::fmt;

pub const DEMO_STAMP: &str = "HL2DEMO";
pub const DEMO_HEADER_BYTES: usize = 1_072;
const FIXED_STRING_BYTES: usize = 260;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DemoCommandKind {
    Signon,
    Packet,
    SyncTick,
    ConsoleCommand,
    UserCommand,
    DataTables,
    Stop,
    CustomData,
    StringTables,
}

impl DemoCommandKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Signon => "signon",
            Self::Packet => "packet",
            Self::SyncTick => "sync-tick",
            Self::ConsoleCommand => "console-command",
            Self::UserCommand => "user-command",
            Self::DataTables => "data-tables",
            Self::Stop => "stop",
            Self::CustomData => "custom-data",
            Self::StringTables => "string-tables",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DemoHeader {
    pub demo_protocol: i32,
    pub network_protocol: i32,
    pub server_name: String,
    pub client_name: String,
    pub map_name: String,
    pub game_directory: String,
    pub playback_time_seconds: f32,
    pub playback_ticks: i32,
    pub playback_frames: i32,
    pub signon_length: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CommandInfo {
    pub flags: i32,
    pub view_origin: Vector3,
    pub view_angles: Vector3,
    pub local_view_angles: Vector3,
    pub view_origin2: Vector3,
    pub view_angles2: Vector3,
    pub local_view_angles2: Vector3,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DemoCommandFrame<'a> {
    pub command: u8,
    pub kind: DemoCommandKind,
    pub tick: Option<i32>,
    pub player_slot: Option<u8>,
    pub offset: usize,
    pub command_info: Vec<CommandInfo>,
    pub sequence_in: Option<i32>,
    pub sequence_out: Option<i32>,
    pub outgoing_sequence: Option<i32>,
    pub custom_data_callback: Option<i32>,
    pub payload: Option<&'a [u8]>,
    pub payload_offset: Option<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DecodeIssueCode {
    UnknownDemoCommand,
    TrailingData,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeIssue {
    pub code: DecodeIssueCode,
    pub offset: usize,
    pub command: Option<u8>,
    pub message: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct DemoDecodeResult<'a> {
    pub header: DemoHeader,
    pub frames: Vec<DemoCommandFrame<'a>>,
    pub issues: Vec<DecodeIssue>,
    pub stopped: bool,
    pub bytes_consumed: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DemoParseErrorCode {
    InputTooLarge,
    InvalidStamp,
    UnsupportedDemoProtocol,
    InvalidHeader,
    CommandLimit,
    InvalidPayloadLength,
    PayloadTooLarge,
    Truncated,
}
impl DemoParseErrorCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InputTooLarge => "INPUT_TOO_LARGE",
            Self::InvalidStamp => "INVALID_STAMP",
            Self::UnsupportedDemoProtocol => "UNSUPPORTED_DEMO_PROTOCOL",
            Self::InvalidHeader => "INVALID_HEADER",
            Self::CommandLimit => "COMMAND_LIMIT",
            Self::InvalidPayloadLength => "INVALID_PAYLOAD_LENGTH",
            Self::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
            Self::Truncated => "TRUNCATED",
        }
    }
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DemoParseError {
    pub code: DemoParseErrorCode,
    pub offset: usize,
    pub message: String,
}
impl fmt::Display for DemoParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for DemoParseError {}
impl From<BinaryReadError> for DemoParseError {
    fn from(value: BinaryReadError) -> Self {
        Self {
            code: DemoParseErrorCode::Truncated,
            offset: value.offset,
            message: format!("Truncated demo at byte {}: {value}", value.offset),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct DecodeOptions {
    pub max_input_bytes: usize,
    pub max_commands: usize,
    pub max_payload_bytes: usize,
}
impl Default for DecodeOptions {
    fn default() -> Self {
        Self {
            max_input_bytes: 512 * 1024 * 1024,
            max_commands: 10_000_000,
            max_payload_bytes: 64 * 1024 * 1024,
        }
    }
}

pub fn decode_demo(
    bytes: &[u8],
    options: DecodeOptions,
) -> Result<DemoDecodeResult<'_>, DemoParseError> {
    validate_options(options)?;
    if bytes.len() > options.max_input_bytes {
        return Err(err(
            DemoParseErrorCode::InputTooLarge,
            0,
            format!(
                "Demo is {} bytes; limit is {}",
                bytes.len(),
                options.max_input_bytes
            ),
        ));
    }
    let mut reader = BinaryReader::new(bytes);
    let header = read_header(&mut reader)?;
    let mut frames = Vec::new();
    let mut issues = Vec::new();
    let mut stopped = false;
    while reader.remaining() > 0 {
        if frames.len() >= options.max_commands {
            return Err(err(
                DemoParseErrorCode::CommandLimit,
                reader.offset(),
                format!("Demo exceeds command limit {}", options.max_commands),
            ));
        }
        let offset = reader.offset();
        let command = reader.u8()?;
        let Some(kind) = command_kind(command) else {
            issues.push(DecodeIssue {
                code: DecodeIssueCode::UnknownDemoCommand,
                offset,
                command: Some(command),
                message: format!(
                    "Unknown demo command {command}; remaining bytes cannot be framed safely"
                ),
            });
            break;
        };
        if kind == DemoCommandKind::Stop {
            let tick = if reader.remaining() >= 4 {
                Some(reader.i32()?)
            } else {
                None
            };
            frames.push(empty_frame(command, kind, tick, None, offset));
            stopped = true;
            if reader.remaining() > 0 {
                issues.push(DecodeIssue {
                    code: DecodeIssueCode::TrailingData,
                    offset: reader.offset(),
                    command: None,
                    message: format!("{} bytes follow the stop command", reader.remaining()),
                });
            }
            break;
        }
        let tick = Some(reader.i32()?);
        let slot = if header.demo_protocol >= 4 {
            Some(reader.u8()?)
        } else {
            None
        };
        let mut frame = empty_frame(command, kind, tick, slot, offset);
        match kind {
            DemoCommandKind::SyncTick => {}
            DemoCommandKind::Signon | DemoCommandKind::Packet => {
                let count = if header.demo_protocol >= 4 { 4 } else { 1 };
                frame.command_info = (0..count)
                    .map(|_| read_command_info(&mut reader))
                    .collect::<Result<_, _>>()?;
                frame.sequence_in = Some(reader.i32()?);
                frame.sequence_out = Some(reader.i32()?);
                read_payload(&mut reader, options.max_payload_bytes, &mut frame)?;
            }
            DemoCommandKind::UserCommand => {
                frame.outgoing_sequence = Some(reader.i32()?);
                read_payload(&mut reader, options.max_payload_bytes, &mut frame)?;
            }
            DemoCommandKind::CustomData => {
                frame.custom_data_callback = Some(reader.i32()?);
                read_payload(&mut reader, options.max_payload_bytes, &mut frame)?;
            }
            _ => read_payload(&mut reader, options.max_payload_bytes, &mut frame)?,
        }
        frames.push(frame);
    }
    Ok(DemoDecodeResult {
        header,
        frames,
        issues,
        stopped,
        bytes_consumed: reader.offset(),
    })
}

fn validate_options(o: DecodeOptions) -> Result<(), DemoParseError> {
    if o.max_input_bytes == 0 || o.max_commands == 0 || o.max_payload_bytes == 0 {
        return Err(err(
            DemoParseErrorCode::InvalidHeader,
            0,
            "decode limits must be positive".into(),
        ));
    }
    Ok(())
}
fn read_header(r: &mut BinaryReader<'_>) -> Result<DemoHeader, DemoParseError> {
    if r.remaining() < DEMO_HEADER_BYTES {
        return Err(err(
            DemoParseErrorCode::Truncated,
            r.offset(),
            format!(
                "Demo header needs {DEMO_HEADER_BYTES} bytes; only {} available",
                r.remaining()
            ),
        ));
    }
    let stamp = r.fixed_latin1(8)?;
    if stamp != DEMO_STAMP {
        return Err(err(
            DemoParseErrorCode::InvalidStamp,
            0,
            format!("Expected {DEMO_STAMP} demo stamp, received {stamp:?}"),
        ));
    }
    let demo_protocol = r.i32()?;
    if demo_protocol != 3 && demo_protocol != 4 {
        return Err(err(
            DemoParseErrorCode::UnsupportedDemoProtocol,
            8,
            format!("Demo protocol {demo_protocol} is not supported (expected 3 or 4)"),
        ));
    }
    let network_protocol = r.i32()?;
    let server_name = r.fixed_latin1(FIXED_STRING_BYTES)?;
    let client_name = r.fixed_latin1(FIXED_STRING_BYTES)?;
    let map_name = r.fixed_latin1(FIXED_STRING_BYTES)?;
    let game_directory = r.fixed_latin1(FIXED_STRING_BYTES)?;
    let playback_time_seconds = r.f32()?;
    let playback_ticks = r.i32()?;
    let playback_frames = r.i32()?;
    let signon_length = r.i32()?;
    if !playback_time_seconds.is_finite()
        || playback_time_seconds < 0.0
        || playback_ticks < 0
        || playback_frames < 0
        || signon_length < 0
    {
        return Err(err(
            DemoParseErrorCode::InvalidHeader,
            DEMO_HEADER_BYTES - 16,
            "Demo header contains negative or non-finite playback metadata".into(),
        ));
    }
    Ok(DemoHeader {
        demo_protocol,
        network_protocol,
        server_name,
        client_name,
        map_name,
        game_directory,
        playback_time_seconds,
        playback_ticks,
        playback_frames,
        signon_length,
    })
}
fn read_vector(r: &mut BinaryReader<'_>) -> Result<Vector3, BinaryReadError> {
    Ok(Vector3 {
        x: r.f32()?,
        y: r.f32()?,
        z: r.f32()?,
    })
}
fn read_command_info(r: &mut BinaryReader<'_>) -> Result<CommandInfo, BinaryReadError> {
    Ok(CommandInfo {
        flags: r.i32()?,
        view_origin: read_vector(r)?,
        view_angles: read_vector(r)?,
        local_view_angles: read_vector(r)?,
        view_origin2: read_vector(r)?,
        view_angles2: read_vector(r)?,
        local_view_angles2: read_vector(r)?,
    })
}
fn read_payload<'a>(
    r: &mut BinaryReader<'a>,
    max: usize,
    frame: &mut DemoCommandFrame<'a>,
) -> Result<(), DemoParseError> {
    let length_offset = r.offset();
    let length = r.i32()?;
    if length < 0 {
        return Err(err(
            DemoParseErrorCode::InvalidPayloadLength,
            length_offset,
            format!("Negative payload length {length}"),
        ));
    }
    let length = usize::try_from(length).expect("nonnegative i32");
    if length > max {
        return Err(err(
            DemoParseErrorCode::PayloadTooLarge,
            length_offset,
            format!("Payload is {length} bytes; limit is {max}"),
        ));
    }
    frame.payload_offset = Some(r.offset());
    frame.payload = Some(r.bytes(length)?);
    Ok(())
}
const fn command_kind(c: u8) -> Option<DemoCommandKind> {
    Some(match c {
        1 => DemoCommandKind::Signon,
        2 => DemoCommandKind::Packet,
        3 => DemoCommandKind::SyncTick,
        4 => DemoCommandKind::ConsoleCommand,
        5 => DemoCommandKind::UserCommand,
        6 => DemoCommandKind::DataTables,
        7 => DemoCommandKind::Stop,
        8 => DemoCommandKind::CustomData,
        9 => DemoCommandKind::StringTables,
        _ => return None,
    })
}
fn empty_frame(
    command: u8,
    kind: DemoCommandKind,
    tick: Option<i32>,
    player_slot: Option<u8>,
    offset: usize,
) -> DemoCommandFrame<'static> {
    DemoCommandFrame {
        command,
        kind,
        tick,
        player_slot,
        offset,
        command_info: Vec::new(),
        sequence_in: None,
        sequence_out: None,
        outgoing_sequence: None,
        custom_data_callback: None,
        payload: None,
        payload_offset: None,
    }
}
fn err(code: DemoParseErrorCode, offset: usize, message: String) -> DemoParseError {
    DemoParseError {
        code,
        offset,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn header(protocol: i32) -> Vec<u8> {
        let mut b = vec![0; DEMO_HEADER_BYTES];
        b[..7].copy_from_slice(b"HL2DEMO");
        b[8..12].copy_from_slice(&protocol.to_le_bytes());
        b[12..16].copy_from_slice(&2100_i32.to_le_bytes());
        b[1056..1060].copy_from_slice(&1_f32.to_le_bytes());
        b[1060..1064].copy_from_slice(&1_i32.to_le_bytes());
        b[1064..1068].copy_from_slice(&1_i32.to_le_bytes());
        b
    }
    #[test]
    fn frames_protocol_four_and_zero_copy_payload() {
        let mut b = header(4);
        b.extend([4]);
        b.extend(3_i32.to_le_bytes());
        b.push(2);
        b.extend(3_i32.to_le_bytes());
        b.extend([1, 2, 3]);
        b.push(7);
        b.extend(4_i32.to_le_bytes());
        let d = decode_demo(&b, DecodeOptions::default()).unwrap();
        assert_eq!(d.frames.len(), 2);
        assert_eq!(d.frames[0].payload, Some(&b[1082..1085]));
        assert_eq!(d.frames[1].player_slot, None);
        assert!(d.stopped);
    }
    #[test]
    fn accepts_old_stop_and_reports_unknown() {
        let mut b = header(4);
        b.push(7);
        assert!(decode_demo(&b, DecodeOptions::default()).unwrap().stopped);
        let mut b = header(4);
        b.push(99);
        let d = decode_demo(&b, DecodeOptions::default()).unwrap();
        assert_eq!(d.issues[0].offset, DEMO_HEADER_BYTES);
    }
    #[test]
    fn every_header_prefix_is_truncated() {
        let b = header(4);
        for end in 0..DEMO_HEADER_BYTES {
            let e = decode_demo(&b[..end], DecodeOptions::default()).unwrap_err();
            assert_eq!(e.code, DemoParseErrorCode::Truncated);
        }
    }
    #[test]
    fn rejects_lengths_before_payload_read() {
        let mut b = header(4);
        b.push(4);
        b.extend(0_i32.to_le_bytes());
        b.push(0);
        b.extend((-1_i32).to_le_bytes());
        let e = decode_demo(&b, DecodeOptions::default()).unwrap_err();
        assert_eq!(e.code, DemoParseErrorCode::InvalidPayloadLength);
        assert_eq!(e.offset, 1078);
    }
}
