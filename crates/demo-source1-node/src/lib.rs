//! Coarse, bytes-only Node-API boundary for the native demo decoder.

use demo_source1_native::artifact::{ArtifactLimits, CompactDemoArtifact, build_compact_artifact};
use demo_source1_native::error::{ProjectError, ProjectErrorCode};
use demo_source1_native::event_wire::{EventTelemetrySummaryWire, RawEventVisitWire};
use demo_source1_native::projection::ProjectLimits;
use demo_source1_native::{DecodeOptions, DemoParseError, decode_demo};
use napi::Task;
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{self, Write};

const BINDING_API_VERSION: u32 = 2;
const FRAMING_SUMMARY_VERSION: u32 = 1;
const PROJECT_CONFIG_VERSION: u32 = 2;
const COMPACT_ARTIFACT_WIRE_VERSION: u32 = 2;
const PARSER_CONFIG_ID: &str = "source1-l4d2-2100-v2";
const MAX_CONFIG_BYTES: usize = 4 * 1024;
const MAX_KEY_BYTES: usize = 64;
const MIN_KEY_BYTES: usize = 16;
const MAX_INPUT_BYTES: usize = 512 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 256 * 1024 * 1024;

#[napi(object)]
pub struct BindingMetadata {
    pub binding_api_version: u32,
    pub framing_summary_version: u32,
    pub project_config_version: u32,
    pub compact_artifact_wire_version: u32,
    pub parser_config_id: String,
    pub build_sha256: String,
    pub binding_crate_version: String,
    pub core_crate_version: String,
    pub node_api_version: u32,
}

#[napi]
#[must_use]
pub fn binding_metadata() -> BindingMetadata {
    BindingMetadata {
        binding_api_version: BINDING_API_VERSION,
        framing_summary_version: FRAMING_SUMMARY_VERSION,
        project_config_version: PROJECT_CONFIG_VERSION,
        compact_artifact_wire_version: COMPACT_ARTIFACT_WIRE_VERSION,
        parser_config_id: PARSER_CONFIG_ID.to_owned(),
        build_sha256: env!("L4DSTATS_NATIVE_BUILD_SHA256").to_owned(),
        binding_crate_version: env!("CARGO_PKG_VERSION").to_owned(),
        core_crate_version: env!("CARGO_PKG_VERSION").to_owned(),
        node_api_version: 8,
    }
}

#[napi(object)]
pub struct CommandCount {
    pub kind: String,
    pub count: u32,
}

#[napi(object)]
pub struct FramingIssue {
    pub code: String,
    pub offset: u32,
    pub command: Option<u32>,
}

#[napi(object)]
pub struct FramingSummary {
    pub schema_version: u32,
    pub demo_protocol: i32,
    pub network_protocol: i32,
    pub playback_ticks: i32,
    pub playback_frames: i32,
    pub playback_time_seconds: f64,
    pub stamp: String,
    pub server_name: String,
    pub client_name: String,
    pub map_name: String,
    pub game_directory: String,
    pub signon_length: i32,
    pub command_sequence_sha256: String,
    pub frame_count: u32,
    pub command_counts: Vec<CommandCount>,
    pub issues: Vec<FramingIssue>,
    pub stopped: bool,
    pub bytes_consumed: u32,
}

pub struct DecodeFramingTask {
    bytes: Vec<u8>,
}

impl Task for DecodeFramingTask {
    type Output = FramingSummary;
    type JsValue = FramingSummary;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let decoded = decode_demo(&self.bytes, DecodeOptions::default())
            .map_err(|error| to_napi_error(&error))?;
        let mut counts = BTreeMap::<&'static str, u32>::new();
        for frame in &decoded.frames {
            let count = counts.entry(frame.kind.as_str()).or_default();
            *count = count.saturating_add(1);
        }
        let frame_count = u32::try_from(decoded.frames.len())
            .map_err(|_| napi::Error::from_reason("COMMAND_LIMIT: frame count exceeds u32"))?;
        let issues = decoded
            .issues
            .into_iter()
            .map(|issue| {
                let offset = u32::try_from(issue.offset).map_err(|_| {
                    napi::Error::from_reason("INPUT_TOO_LARGE: issue offset exceeds u32")
                })?;
                Ok(FramingIssue {
                    code: match issue.code {
                        demo_source1_native::demo::DecodeIssueCode::UnknownDemoCommand => {
                            "UNKNOWN_DEMO_COMMAND"
                        }
                        demo_source1_native::demo::DecodeIssueCode::TrailingData => "TRAILING_DATA",
                    }
                    .to_owned(),
                    offset,
                    command: issue.command.map(u32::from),
                })
            })
            .collect::<napi::Result<Vec<_>>>()?;
        Ok(FramingSummary {
            schema_version: FRAMING_SUMMARY_VERSION,
            demo_protocol: decoded.header.demo_protocol,
            network_protocol: decoded.header.network_protocol,
            playback_ticks: decoded.header.playback_ticks,
            playback_frames: decoded.header.playback_frames,
            playback_time_seconds: f64::from(decoded.header.playback_time_seconds),
            stamp: demo_source1_native::demo::DEMO_STAMP.to_owned(),
            server_name: decoded.header.server_name,
            client_name: decoded.header.client_name,
            map_name: decoded.header.map_name,
            game_directory: decoded.header.game_directory,
            signon_length: decoded.header.signon_length,
            command_sequence_sha256: command_sequence_sha256(
                decoded
                    .frames
                    .iter()
                    .map(|frame| (frame.tick, frame.kind.as_str())),
            ),
            frame_count,
            command_counts: counts
                .into_iter()
                .map(|(kind, count)| CommandCount {
                    kind: kind.to_owned(),
                    count,
                })
                .collect(),
            issues,
            stopped: decoded.stopped,
            bytes_consumed: u32::try_from(decoded.bytes_consumed).map_err(|_| {
                napi::Error::from_reason("INPUT_TOO_LARGE: consumed byte count exceeds u32")
            })?,
        })
    }

    fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

fn command_sequence_sha256<'a>(frames: impl IntoIterator<Item = (Option<i32>, &'a str)>) -> String {
    let mut sequence = Sha256::new();
    for (tick, kind) in frames {
        let tick = tick.map_or_else(|| "null".to_owned(), |value| value.to_string());
        sequence.update(format!("{tick}\t{kind}\n"));
    }
    hex::encode(sequence.finalize())
}

#[cfg(test)]
mod framing_summary_tests {
    use super::command_sequence_sha256;

    #[test]
    fn hashes_the_typescript_tick_kind_wire_exactly() {
        assert_eq!(
            command_sequence_sha256([(Some(1), "packet"), (None, "stop")]),
            "6b5c6b6bcf34dfc9102d484ca74e201c943db7fbfcf0acec7c15ea34d707b5ed"
        );
    }
}

/// Copies the caller-owned Buffer once, then parses it on the libuv worker pool.
#[napi]
#[must_use]
pub fn decode_framing_summary(bytes: Buffer) -> AsyncTask<DecodeFramingTask> {
    AsyncTask::new(DecodeFramingTask {
        bytes: bytes.into(),
    })
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectConfigV2 {
    schema_version: u32,
    parser_config: String,
    max_input_bytes: usize,
    max_observations: usize,
    max_identity_mappings: usize,
    max_match_states: usize,
    max_raw_events: usize,
    max_required_events: usize,
    max_event_kinds: usize,
    max_output_bytes: usize,
}

impl ProjectConfigV2 {
    fn artifact_limits(&self) -> ArtifactLimits {
        ArtifactLimits {
            projection: ProjectLimits {
                max_observations: self.max_observations,
                max_identity_mappings: self.max_identity_mappings,
                max_match_states: self.max_match_states,
            },
            max_raw_events: self.max_raw_events,
            max_required_events: self.max_required_events,
            max_event_kinds: self.max_event_kinds,
        }
    }
}

pub struct ProjectDemoTask {
    demo_bytes: Vec<u8>,
    pseudonym_key: Vec<u8>,
    config: ProjectConfigV2,
}

impl Task for ProjectDemoTask {
    type Output = Vec<u8>;
    type JsValue = Buffer;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let artifact = build_compact_artifact(
            &self.demo_bytes,
            &self.pseudonym_key,
            self.config.artifact_limits(),
        )
        .map_err(|error| project_napi_error(&error))?;
        serialize_artifact(&artifact, self.config.max_output_bytes)
            .map_err(|error| project_napi_error(&error))
    }

    fn resolve(&mut self, _env: napi::Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output.into())
    }
}

/// Projects one caller-owned demo Buffer off the JavaScript event loop.
///
/// The demo and key are copied exactly once before the task enters libuv. The
/// returned Vec transfers ownership to a Node Buffer.
#[napi]
pub fn project_demo(
    demo_bytes: Buffer,
    pseudonym_key: Buffer,
    config_bytes: Buffer,
) -> napi::Result<AsyncTask<ProjectDemoTask>> {
    let config_data: Vec<u8> = config_bytes.into();
    let config = parse_config(&config_data).map_err(|error| project_napi_error(&error))?;
    let key_length = pseudonym_key.len();
    if !(MIN_KEY_BYTES..=MAX_KEY_BYTES).contains(&key_length) {
        return Err(config_napi_error(
            "pseudonymKey must contain between 16 and 64 bytes",
        ));
    }
    if demo_bytes.len() > config.max_input_bytes {
        return Err(config_napi_error(
            "demo input exceeds configured byte limit",
        ));
    }
    Ok(AsyncTask::new(ProjectDemoTask {
        demo_bytes: demo_bytes.into(),
        pseudonym_key: pseudonym_key.into(),
        config,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompactArtifactWireV1<'a> {
    version: u32,
    header: &'a demo_source1_native::artifact::ArtifactHeader,
    framing_issues: &'a [demo_source1_native::demo::DecodeIssue],
    bytes_consumed: usize,
    stopped: bool,
    projection: ProjectionWireV1<'a>,
    raw_events: Vec<RawEventVisitWire>,
    event_summary: EventTelemetrySummaryWire,
    source_perspective: demo_source1_native::artifact::SourcePerspective,
    recorder_commands: &'a [demo_source1_native::artifact::RecorderCommand],
    command_telemetry_summary: &'a demo_source1_native::artifact::CommandTelemetrySummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionWireV1<'a> {
    demo_sha256: &'a str,
    epochs: &'a [demo_source1_native::projection::CoreEpoch],
    display_identities: &'a [demo_source1_native::identity::DisplayIdentity],
    identity_mappings: &'a [demo_source1_native::identity::UserInfoMapping],
    rejected_identity_entries: usize,
    server_info: &'a Option<demo_source1_native::projection::ServerMetadata>,
    match_states: &'a [demo_source1_native::projection::MatchState],
    witch_observations: &'a [demo_source1_native::projection::L4d2WitchObservation],
    coverage: &'a demo_source1_native::projection::ProjectionCoverage,
    observations: &'a demo_source1_native::direct_wire::DirectCompactObservations,
}

fn serialize_artifact(
    artifact: &CompactDemoArtifact,
    maximum: usize,
) -> Result<Vec<u8>, ProjectError> {
    let wire = CompactArtifactWireV1 {
        version: COMPACT_ARTIFACT_WIRE_VERSION,
        header: &artifact.header,
        framing_issues: &artifact.framing_issues,
        bytes_consumed: artifact.bytes_consumed,
        stopped: artifact.stopped,
        projection: ProjectionWireV1 {
            demo_sha256: &artifact.projection.demo_sha256,
            epochs: &artifact.projection.epochs,
            display_identities: &artifact.projection.display_identities,
            identity_mappings: &artifact.projection.identity_mappings,
            rejected_identity_entries: artifact.projection.rejected_identity_entries,
            server_info: &artifact.projection.server_info,
            match_states: &artifact.projection.match_states,
            witch_observations: &artifact.projection.witch_observations,
            coverage: &artifact.projection.coverage,
            observations: &artifact.observations,
        },
        raw_events: artifact.raw_events.iter().map(Into::into).collect(),
        event_summary: (&artifact.event_summary).into(),
        source_perspective: artifact.source_perspective,
        recorder_commands: &artifact.recorder_commands,
        command_telemetry_summary: &artifact.command_telemetry_summary,
    };
    let mut writer = CappedWriter::new(maximum);
    serde_json::to_writer(&mut writer, &wire).map_err(|error| ProjectError {
        version: 1,
        code: ProjectErrorCode::SerializationFailed,
        stage: "artifact-serialization".to_owned(),
        offset: None,
        message: if writer.exceeded {
            "serialized artifact exceeds configured output limit".to_owned()
        } else {
            format!("failed to serialize artifact: {error}")
        },
    })?;
    Ok(writer.output)
}

struct CappedWriter {
    output: Vec<u8>,
    maximum: usize,
    exceeded: bool,
}

impl CappedWriter {
    fn new(maximum: usize) -> Self {
        Self {
            output: Vec::with_capacity(maximum.min(1024 * 1024)),
            maximum,
            exceeded: false,
        }
    }
}

impl Write for CappedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let Some(next) = self.output.len().checked_add(bytes.len()) else {
            self.exceeded = true;
            return Err(io::Error::other("artifact output length overflow"));
        };
        if next > self.maximum {
            self.exceeded = true;
            return Err(io::Error::other("artifact output limit exceeded"));
        }
        self.output.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn parse_config(bytes: &[u8]) -> Result<ProjectConfigV2, ProjectError> {
    if bytes.is_empty() || bytes.len() > MAX_CONFIG_BYTES {
        return Err(config_error("config must contain between 1 and 4096 bytes"));
    }
    let config: ProjectConfigV2 = serde_json::from_slice(bytes)
        .map_err(|_| config_error("config is not canonical v2 JSON"))?;
    let canonical =
        serde_json::to_vec(&config).map_err(|_| config_error("config canonicalization failed"))?;
    if canonical != bytes {
        return Err(config_error(
            "config must use canonical field order with no whitespace, duplicates, or trailing data",
        ));
    }
    if config.schema_version != PROJECT_CONFIG_VERSION || config.parser_config != PARSER_CONFIG_ID {
        return Err(config_error(
            "unsupported config schemaVersion or parserConfig",
        ));
    }
    let default = ArtifactLimits::default();
    if config.max_input_bytes == 0
        || config.max_input_bytes > MAX_INPUT_BYTES
        || config.max_observations == 0
        || config.max_observations > default.projection.max_observations
        || config.max_identity_mappings == 0
        || config.max_identity_mappings > default.projection.max_identity_mappings
        || config.max_match_states == 0
        || config.max_match_states > default.projection.max_match_states
        || config.max_raw_events == 0
        || config.max_raw_events > default.max_raw_events
        || config.max_required_events == 0
        || config.max_required_events > default.max_required_events
        || config.max_event_kinds == 0
        || config.max_event_kinds > default.max_event_kinds
        || config.max_output_bytes == 0
        || config.max_output_bytes > MAX_OUTPUT_BYTES
    {
        return Err(config_error(
            "config contains an invalid or excessive resource limit",
        ));
    }
    Ok(config)
}

fn config_error(message: &str) -> ProjectError {
    ProjectError {
        version: 1,
        code: ProjectErrorCode::InvalidTelemetry,
        stage: "binding-config".to_owned(),
        offset: None,
        message: message.to_owned(),
    }
}

fn project_napi_error(error: &ProjectError) -> napi::Error {
    let encoded = serde_json::to_string(&error).unwrap_or_else(|_| {
        "{\"version\":1,\"code\":\"SERIALIZATION_FAILED\",\"stage\":\"binding\",\"offset\":null,\"message\":\"failed to encode project error\"}".to_owned()
    });
    napi::Error::from_reason(format!("PROJECT_ERROR:{encoded}"))
}

fn config_napi_error(message: &str) -> napi::Error {
    project_napi_error(&config_error(message))
}

fn to_napi_error(error: &DemoParseError) -> napi::Error {
    napi::Error::from_reason(format!(
        "{}@{}: {}",
        error.code.as_str(),
        error.offset,
        error.message
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ProjectConfigV2 {
        let limits = ArtifactLimits::default();
        ProjectConfigV2 {
            schema_version: 2,
            parser_config: PARSER_CONFIG_ID.to_owned(),
            max_input_bytes: MAX_INPUT_BYTES,
            max_observations: limits.projection.max_observations,
            max_identity_mappings: limits.projection.max_identity_mappings,
            max_match_states: limits.projection.max_match_states,
            max_raw_events: limits.max_raw_events,
            max_required_events: limits.max_required_events,
            max_event_kinds: limits.max_event_kinds,
            max_output_bytes: MAX_OUTPUT_BYTES,
        }
    }

    #[test]
    fn config_is_exact_canonical_and_rejects_unknown_duplicate_and_trailing() {
        let bytes = serde_json::to_vec(&config()).unwrap();
        assert_eq!(parse_config(&bytes).unwrap(), config());
        for invalid in [
            b"{}".as_slice(),
            b"{\"schemaVersion\":1,\"schemaVersion\":1}".as_slice(),
            b"{} ".as_slice(),
            b"{\"unknown\":1}".as_slice(),
        ] {
            assert!(parse_config(invalid).is_err());
        }
        assert!(parse_config(&vec![b'x'; MAX_CONFIG_BYTES + 1]).is_err());
    }

    #[test]
    fn capped_writer_fails_before_crossing_limit() {
        let mut writer = CappedWriter::new(3);
        assert_eq!(writer.write(b"abc").unwrap(), 3);
        assert!(writer.write(b"d").is_err());
        assert_eq!(writer.output, b"abc");
        assert!(writer.exceeded);
    }
}
