use crate::demo::{DecodeIssue, DemoCommandKind};
use crate::direct_wire::{DirectCompactObservations, project_direct_compact_prepared};
use crate::error::ProjectError;
use crate::game_events::{
    DecodedGameEvent, GameEventDecoder, RequiredEvent, project_required_event,
};
use crate::network::{Envelope, extract_network_bits};
use crate::projection::{CoreProjection, ProjectLimits};
use crate::usercmd::{UserCommand, decode_user_command};
use serde::Serialize;
use std::collections::BTreeMap;

pub const COMPACT_ARTIFACT_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactHeader {
    pub stamp: String,
    pub demo_protocol: i32,
    pub network_protocol: i32,
    pub server_name: String,
    pub client_name: String,
    pub map_name: String,
    pub game_directory: String,
    pub playback_time_seconds: f64,
    pub playback_ticks: i32,
    pub playback_frames: i32,
    pub signon_length: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct ArtifactLimits {
    pub projection: ProjectLimits,
    pub max_raw_events: usize,
    pub max_required_events: usize,
    pub max_event_kinds: usize,
}
impl Default for ArtifactLimits {
    fn default() -> Self {
        Self {
            projection: ProjectLimits::default(),
            max_raw_events: 2_000_000,
            max_required_events: 1_000_000,
            max_event_kinds: 4_096,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourcePerspective {
    SourceTv,
    PlayerPov,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderCommand {
    pub demo_tick: i32,
    pub recorder_player_slot: Option<u8>,
    pub outgoing_sequence: i32,
    #[serde(flatten)]
    pub command: UserCommand,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecorderIdentityConfidence {
    Observed,
    Inferred,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandTelemetrySummary {
    pub commands: usize,
    pub decoded_commands: usize,
    pub malformed_commands: usize,
    pub first_demo_tick: Option<i32>,
    pub last_demo_tick: Option<i32>,
    pub recorder_player_slot: Option<u8>,
    pub recorder_identity_confidence: RecorderIdentityConfidence,
    pub gaps: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEventVisit {
    pub demo_tick: i32,
    pub engine_tick: Option<u32>,
    pub event: DecodedGameEvent,
    pub required: Option<RequiredEvent>,
}
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTelemetrySummary {
    pub schema_lists: usize,
    pub schemas: usize,
    pub events: usize,
    pub required_events: BTreeMap<String, usize>,
}

#[derive(Debug, Serialize)]
pub struct CompactDemoArtifact {
    pub version: u32,
    pub header: ArtifactHeader,
    pub framing_issues: Vec<DecodeIssue>,
    pub bytes_consumed: usize,
    pub stopped: bool,
    pub projection: CoreProjection,
    pub observations: DirectCompactObservations,
    pub raw_events: Vec<RawEventVisit>,
    pub event_summary: EventTelemetrySummary,
    pub required_events: Vec<RequiredEvent>,
    pub source_perspective: SourcePerspective,
    pub recorder_commands: Vec<RecorderCommand>,
    pub command_telemetry_summary: CommandTelemetrySummary,
}

#[allow(clippy::too_many_lines)]
pub fn build_compact_artifact(
    bytes: &[u8],
    key: &[u8],
    limits: ArtifactLimits,
) -> Result<CompactDemoArtifact, ProjectError> {
    if limits.max_raw_events == 0 || limits.max_required_events == 0 || limits.max_event_kinds == 0
    {
        return Err(ProjectError::classify(
            "artifact-limits",
            "artifact limits must be positive",
        ));
    }
    let prepared = crate::traversal::PreparedDemo::new(bytes)?;
    let demo = &prepared.demo;
    let direct = project_direct_compact_prepared(&prepared, key, limits.projection)
        .map_err(|message| ProjectError::classify("projection", message))?;
    let projection = direct.projection;
    let observations = direct.observations;
    let header = ArtifactHeader {
        stamp: "HL2DEMO".into(),
        demo_protocol: demo.header.demo_protocol,
        network_protocol: demo.header.network_protocol,
        server_name: demo.header.server_name.clone(),
        client_name: demo.header.client_name.clone(),
        map_name: demo.header.map_name.clone(),
        game_directory: demo.header.game_directory.clone(),
        playback_time_seconds: f64::from(demo.header.playback_time_seconds),
        playback_ticks: demo.header.playback_ticks,
        playback_frames: demo.header.playback_frames,
        signon_length: demo.header.signon_length,
    };
    let mut decoder = GameEventDecoder::default();
    let mut raw_events = Vec::new();
    let mut event_summary = EventTelemetrySummary::default();
    let mut required_events = Vec::new();
    let source_perspective = demo
        .frames
        .iter()
        .enumerate()
        .find_map(|(index, _)| {
            prepared.inspection(index).and_then(|inspection| {
                inspection
                    .messages
                    .iter()
                    .find_map(|message| match message.envelope {
                        Some(Envelope::ServerInfo { is_source_tv, .. }) => Some(if is_source_tv {
                            SourcePerspective::SourceTv
                        } else {
                            SourcePerspective::PlayerPov
                        }),
                        _ => None,
                    })
            })
        })
        .unwrap_or(SourcePerspective::Unknown);
    let mut recorder_commands = Vec::new();
    let mut command_count = 0_usize;
    let mut malformed_commands = 0_usize;
    let mut command_slots = std::collections::BTreeSet::new();
    for frame in &demo.frames {
        if frame.kind != DemoCommandKind::UserCommand {
            continue;
        }
        command_count += 1;
        if command_count > 10_000_000 {
            return Err(ProjectError::classify(
                "user-command-limits",
                "user-command visit limit exceeded",
            ));
        }
        if let Some(slot) = frame.player_slot {
            command_slots.insert(slot);
        }
        let Some(payload) = frame.payload else {
            malformed_commands += 1;
            continue;
        };
        let Some(outgoing_sequence) = frame.outgoing_sequence else {
            malformed_commands += 1;
            continue;
        };
        match (frame.tick, decode_user_command(payload)) {
            (Some(demo_tick), Ok(command)) if command.command_number == outgoing_sequence => {
                recorder_commands.push(RecorderCommand {
                    demo_tick,
                    recorder_player_slot: frame.player_slot,
                    outgoing_sequence,
                    command,
                });
            }
            _ => malformed_commands += 1,
        }
    }
    let gaps = recorder_commands
        .windows(2)
        .filter(|pair| {
            pair[1].command.command_number != pair[0].command.command_number.saturating_add(1)
        })
        .count();
    let recorder_player_slot = (command_slots.len() == 1)
        .then(|| command_slots.first().copied())
        .flatten();
    let command_telemetry_summary = CommandTelemetrySummary {
        commands: command_count,
        decoded_commands: recorder_commands.len(),
        malformed_commands,
        first_demo_tick: recorder_commands.first().map(|command| command.demo_tick),
        last_demo_tick: recorder_commands.last().map(|command| command.demo_tick),
        recorder_player_slot,
        // The outer demo player slot identifies a command stream, not a
        // stable player epoch. Recorder identity remains unavailable until a
        // separately validated identity join is implemented.
        recorder_identity_confidence: RecorderIdentityConfidence::Unavailable,
        gaps,
    };
    for (frame_index, frame) in demo.frames.iter().enumerate() {
        if !matches!(
            frame.kind,
            DemoCommandKind::Packet | DemoCommandKind::Signon
        ) {
            continue;
        }
        let Some(payload) = frame.payload else {
            continue;
        };
        let inspection = prepared.inspection(frame_index).ok_or_else(|| {
            ProjectError::classify_at(
                "network",
                frame.payload_offset,
                "missing network inspection",
            )
        })?;
        if !inspection.complete {
            return Err(ProjectError::classify_at(
                "network",
                frame.payload_offset,
                "network payload did not traverse completely",
            ));
        }
        let ticks: Vec<_> = inspection
            .messages
            .iter()
            .filter_map(|message| match message.envelope {
                Some(Envelope::Tick { engine_tick }) => Some(engine_tick),
                _ => None,
            })
            .collect();
        let engine_tick = if ticks.len() == 1 {
            ticks.first().copied()
        } else {
            None
        };
        for message in &inspection.messages {
            match &message.envelope {
                Some(Envelope::GameEventList {
                    event_count,
                    data_bit_length,
                    data_start_bit,
                }) => {
                    let data = extract_network_bits(
                        payload,
                        *data_start_bit,
                        usize::try_from(*data_bit_length).map_err(|_| {
                            ProjectError::classify_at(
                                "event-schema",
                                frame.payload_offset,
                                "event bits overflow",
                            )
                        })?,
                    )
                    .map_err(|message| {
                        ProjectError::classify_at("event-schema", frame.payload_offset, message)
                    })?;
                    decoder
                        .register(
                            &data,
                            usize::try_from(*data_bit_length).map_err(|_| {
                                ProjectError::classify_at(
                                    "event-schema",
                                    frame.payload_offset,
                                    "event bits overflow",
                                )
                            })?,
                            usize::try_from(*event_count).map_err(|_| {
                                ProjectError::classify_at(
                                    "event-schema",
                                    frame.payload_offset,
                                    "event count overflow",
                                )
                            })?,
                        )
                        .map_err(|message| {
                            ProjectError::classify_at("event-schema", frame.payload_offset, message)
                        })?;
                    event_summary.schema_lists += 1;
                    event_summary.schemas = decoder.schemas().len();
                }
                Some(Envelope::GameEvent {
                    data_bit_length,
                    data_start_bit,
                }) => {
                    if raw_events.len() >= limits.max_raw_events {
                        return Err(ProjectError::classify(
                            "event-limits",
                            "raw event visit limit exceeded",
                        ));
                    }
                    let data = extract_network_bits(
                        payload,
                        *data_start_bit,
                        usize::try_from(*data_bit_length).map_err(|_| {
                            ProjectError::classify_at(
                                "event-decode",
                                frame.payload_offset,
                                "event bits overflow",
                            )
                        })?,
                    )
                    .map_err(|message| {
                        ProjectError::classify_at("event-decode", frame.payload_offset, message)
                    })?;
                    let event = decoder
                        .decode(
                            &data,
                            usize::try_from(*data_bit_length).map_err(|_| {
                                ProjectError::classify_at(
                                    "event-decode",
                                    frame.payload_offset,
                                    "event bits overflow",
                                )
                            })?,
                        )
                        .map_err(|message| {
                            ProjectError::classify_at("event-decode", frame.payload_offset, message)
                        })?;
                    let demo_tick = frame.tick.unwrap_or_else(|| {
                        engine_tick
                            .and_then(|tick| i32::try_from(tick).ok())
                            .unwrap_or(0)
                    });
                    let event_tick = engine_tick
                        .and_then(|tick| i32::try_from(tick).ok())
                        .unwrap_or(demo_tick);
                    let required = project_required_event(&event, event_tick);
                    event_summary.events += 1;
                    if let Some(required) = &required {
                        if required_events.len() >= limits.max_required_events {
                            return Err(ProjectError::classify(
                                "event-limits",
                                "required event limit exceeded",
                            ));
                        }
                        if !event_summary.required_events.contains_key(&required.name)
                            && event_summary.required_events.len() >= limits.max_event_kinds
                        {
                            return Err(ProjectError::classify(
                                "event-limits",
                                "required event-kind limit exceeded",
                            ));
                        }
                        *event_summary
                            .required_events
                            .entry(required.name.clone())
                            .or_default() += 1;
                        required_events.push(required.clone());
                    }
                    raw_events.push(RawEventVisit {
                        demo_tick,
                        engine_tick,
                        event,
                        required,
                    });
                }
                _ => {}
            }
        }
    }
    Ok(CompactDemoArtifact {
        version: COMPACT_ARTIFACT_VERSION,
        header,
        framing_issues: demo.issues.clone(),
        bytes_consumed: demo.bytes_consumed,
        stopped: demo.stopped,
        projection,
        observations,
        raw_events,
        event_summary,
        required_events,
        source_perspective,
        recorder_commands,
        command_telemetry_summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_artifact_limits_before_parsing() {
        let error = build_compact_artifact(
            &[],
            b"0123456789abcdef",
            ArtifactLimits {
                max_raw_events: 0,
                ..ArtifactLimits::default()
            },
        )
        .unwrap_err();
        assert!(error.message.contains("positive"));
    }

    #[test]
    fn truncated_artifact_failure_is_deterministic() {
        let first =
            build_compact_artifact(b"HL2DEMO", b"0123456789abcdef", ArtifactLimits::default())
                .unwrap_err();
        let second =
            build_compact_artifact(b"HL2DEMO", b"0123456789abcdef", ArtifactLimits::default())
                .unwrap_err();
        assert_eq!(first, second);
        assert!(!first.message.is_empty());
        assert_eq!(first.code, crate::error::ProjectErrorCode::DecodeFailed);
        assert_eq!(first.stage, "framing");
        assert_eq!(first.offset, Some(0));
    }

    #[test]
    fn artifact_path_constructs_exactly_one_outer_traversal() {
        let mut bytes = vec![0_u8; crate::demo::DEMO_HEADER_BYTES];
        bytes[..7].copy_from_slice(b"HL2DEMO");
        bytes[8..12].copy_from_slice(&4_i32.to_le_bytes());
        bytes[12..16].copy_from_slice(&2100_i32.to_le_bytes());
        bytes.push(7); // stop
        crate::traversal::reset_prepare_count();
        let _ = build_compact_artifact(&bytes, b"0123456789abcdef", ArtifactLimits::default());
        assert_eq!(crate::traversal::prepare_count(), 1);
    }

    #[test]
    fn corrupt_protocol_has_stable_typed_location() {
        let mut bytes = vec![0_u8; crate::demo::DEMO_HEADER_BYTES];
        bytes[..7].copy_from_slice(b"HL2DEMO");
        bytes[8..12].copy_from_slice(&3_i32.to_le_bytes());
        bytes[12..16].copy_from_slice(&2100_i32.to_le_bytes());
        let error = build_compact_artifact(&bytes, b"0123456789abcdef", ArtifactLimits::default())
            .unwrap_err();
        assert_eq!(error.code, crate::error::ProjectErrorCode::InvalidProtocol);
        assert_eq!(error.stage, "framing");
        assert_eq!(error.offset, Some(8));
    }
}
