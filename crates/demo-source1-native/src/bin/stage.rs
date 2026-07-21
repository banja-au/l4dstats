use demo_source1_native::artifact::{ArtifactLimits, build_compact_artifact};
use demo_source1_native::data_tables::{decode_l4d2_data_tables, flatten_server_classes};
use demo_source1_native::demo::DemoCommandKind;
use demo_source1_native::entities::reconstruct_entity_summaries;
use demo_source1_native::game_events::{EventValue, GameEventDecoder};
use demo_source1_native::identity::collect_userinfo_timeline;
use demo_source1_native::network::{Envelope, extract_network_bits};
use demo_source1_native::network::{NetworkLimits, inspect_network_payload};
use demo_source1_native::projection::project_core;
use demo_source1_native::string_tables::{StringTableLimits, decode_string_table_snapshot};
use demo_source1_native::{DecodeOptions, decode_demo};
use serde::Serialize;
use std::{env, fmt::Write as _, fs, io, process::ExitCode};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactStageWire<'a> {
    version: u32,
    header: &'a demo_source1_native::artifact::ArtifactHeader,
    framing_issues: &'a [demo_source1_native::demo::DecodeIssue],
    bytes_consumed: usize,
    stopped: bool,
    projection: ProjectionStageWire<'a>,
    raw_events: Vec<demo_source1_native::event_wire::RawEventVisitWire>,
    event_summary: demo_source1_native::event_wire::EventTelemetrySummaryWire,
    source_perspective: demo_source1_native::artifact::SourcePerspective,
    recorder_commands: &'a [demo_source1_native::artifact::RecorderCommand],
    command_telemetry_summary: &'a demo_source1_native::artifact::CommandTelemetrySummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionStageWire<'a> {
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

#[allow(clippy::too_many_lines)]
fn main() -> ExitCode {
    let mut args = env::args_os().skip(1);
    let Some(first) = args.next() else {
        eprintln!(
            "usage: demo-source1-stage [framing|network|schemas|events|identity|entities|projection|artifact|artifact-check] <demo.dem>"
        );
        return ExitCode::from(2);
    };
    if first == "--version-json" {
        let hash = option_env!("L4DSTATS_NATIVE_BUILD_SHA256")
            .unwrap_or("0000000000000000000000000000000000000000000000000000000000000000");
        println!(
            "{{\"artifactSchemaVersion\":1,\"buildSha256\":{:?},\"parser\":\"l4dstats-demo-source1-native\",\"projectionSchema\":\"demo-projection/v1\",\"protocol\":\"source1-l4d2-2100\",\"version\":{:?}}}",
            hash,
            env!("CARGO_PKG_VERSION")
        );
        return ExitCode::SUCCESS;
    }
    let (mode, path) = if first == "framing"
        || first == "network"
        || first == "schemas"
        || first == "events"
        || first == "identity"
        || first == "entities"
        || first == "projection"
        || first == "artifact"
        || first == "artifact-check"
    {
        (first.to_string_lossy().into_owned(), args.next())
    } else {
        ("framing".into(), Some(first))
    };
    let Some(path) = path else {
        eprintln!("missing demo path");
        return ExitCode::from(2);
    };
    let bytes = match fs::read(path) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("read error: {e}");
            return ExitCode::FAILURE;
        }
    };
    match decode_demo(&bytes, DecodeOptions::default()) {
        Ok(_d) if mode == "artifact" || mode == "artifact-check" => {
            let artifact = match build_compact_artifact(
                &bytes,
                b"native-parity-key-32-bytes-long!!",
                ArtifactLimits::default(),
            ) {
                Ok(value) => value,
                Err(error) => {
                    let envelope = error;
                    eprintln!(
                        "{}",
                        serde_json::to_string(&envelope)
                            .unwrap_or_else(|_| "{\"version\":1,\"code\":\"SERIALIZATION_FAILED\",\"stage\":\"artifact\",\"offset\":null,\"message\":\"failed to encode error envelope\"}".into())
                    );
                    return ExitCode::FAILURE;
                }
            };
            if mode == "artifact-check" {
                println!(
                    "{}",
                    serde_json::json!({
                        "stage": "artifact-check-v2",
                        "demoSha256": &artifact.projection.demo_sha256,
                        "sourcePerspective": &artifact.source_perspective,
                        "bytesConsumed": artifact.bytes_consumed,
                        "stopped": artifact.stopped,
                        "epochs": artifact.projection.epochs.len(),
                        "events": artifact.raw_events.len(),
                        "recorderCommands": artifact.recorder_commands.len(),
                        "decodedRecorderCommands": artifact.command_telemetry_summary.decoded_commands,
                        "malformedRecorderCommands": artifact.command_telemetry_summary.malformed_commands,
                    })
                );
                return ExitCode::SUCCESS;
            }
            let stdout = io::stdout();
            let wire = ArtifactStageWire {
                version: artifact.version,
                header: &artifact.header,
                framing_issues: &artifact.framing_issues,
                bytes_consumed: artifact.bytes_consumed,
                stopped: artifact.stopped,
                projection: ProjectionStageWire {
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
            if let Err(error) = serde_json::to_writer(stdout.lock(), &wire) {
                eprintln!("artifact serialization: {error}");
                return ExitCode::FAILURE;
            }
            println!();
            ExitCode::SUCCESS
        }
        Ok(_d) if mode == "projection" => {
            let value = match project_core(&bytes, b"native-parity-key-32-bytes-long!!") {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("projection: {e}");
                    return ExitCode::FAILURE;
                }
            };
            print!(
                "{{\"stage\":\"projection-v1\",\"demoSha256\":{},\"epochs\":[",
                json_string(&value.demo_sha256)
            );
            for (i, v) in value.epochs.iter().enumerate() {
                if i > 0 {
                    print!(",");
                }
                print!(
                    "[{},{},{},{},{},{},{}]",
                    json_string(&v.id),
                    v.entity_slot,
                    v.lifetime,
                    v.user_id.map_or("null".into(), |x| x.to_string()),
                    v.stable_token
                        .as_ref()
                        .map_or("null".into(), |x| json_string(x)),
                    v.connected_at_tick,
                    v.disconnected_at_tick
                        .map_or("null".into(), |x| x.to_string())
                );
            }
            print!("],\"observations\":[");
            for (i, v) in value.observations.iter().enumerate() {
                if i > 0 {
                    print!(",");
                }
                print!(
                    "[{},{},{},{},{},{},{},{}]",
                    json_string(&v.player_epoch_id),
                    v.tick,
                    v.entity_index,
                    opt_vec(v.position),
                    opt_vec(v.eye_angles),
                    v.team.map_or("null".into(), |x| x.to_string()),
                    v.player_class
                        .as_ref()
                        .map_or("null".into(), |x| json_string(x)),
                    v.weapon.as_ref().map_or("null".into(), |x| json_string(x))
                );
            }
            println!("]}}");
            ExitCode::SUCCESS
        }
        Ok(_d) if mode == "entities" => {
            let values = match reconstruct_entity_summaries(&bytes) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("entities: {e}");
                    return ExitCode::FAILURE;
                }
            };
            print!("{{\"stage\":\"entities-v1\",\"frames\":[");
            for (i, v) in values.iter().enumerate() {
                if i > 0 {
                    print!(",");
                }
                print!(
                    "[{},{},{},{}]",
                    v.demo_tick, v.engine_tick, v.entities, v.terror_players
                );
            }
            println!("]}}");
            ExitCode::SUCCESS
        }
        Ok(_d) if mode == "identity" => {
            let value =
                match collect_userinfo_timeline(&bytes, b"native-parity-key-32-bytes-long!!") {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("identity: {e}");
                        return ExitCode::FAILURE;
                    }
                };
            print!(
                "{{\"stage\":\"identity-v1\",\"rejectedEntries\":{},\"mappings\":[",
                value.rejected_entries
            );
            for (i, v) in value.mappings.iter().enumerate() {
                if i > 0 {
                    print!(",");
                }
                print!(
                    "[{},{},{},{},{}]",
                    v.entity_index,
                    v.user_info_slot,
                    v.user_id.map_or("null".into(), |x| x.to_string()),
                    v.effective_tick.map_or("null".into(), |x| x.to_string()),
                    v.stable_identity_token
                        .as_ref()
                        .map_or("null".into(), |x| json_string(x))
                );
            }
            print!("],\"display\":[");
            for (i, v) in value.display_identities.iter().enumerate() {
                if i > 0 {
                    print!(",");
                }
                print!(
                    "[{},{},{},{},{},{},{}]",
                    v.entity_index,
                    v.user_info_slot,
                    v.user_id,
                    v.effective_tick.map_or("null".into(), |x| x.to_string()),
                    json_string(&v.display_name),
                    v.fake_player,
                    v.steam_id64
                        .as_ref()
                        .map_or("null".into(), |x| json_string(x))
                );
            }
            println!("]}}");
            ExitCode::SUCCESS
        }
        Ok(d) if mode == "events" => {
            let mut decoder = GameEventDecoder::default();
            let mut emitted = 0;
            print!("{{\"stage\":\"events-v1\",\"events\":[");
            for frame in &d.frames {
                if !matches!(
                    frame.kind,
                    DemoCommandKind::Packet | DemoCommandKind::Signon
                ) {
                    continue;
                }
                let Some(payload) = frame.payload else {
                    continue;
                };
                let inspection = match inspect_network_payload(payload, NetworkLimits::default()) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("network error: {e}");
                        return ExitCode::FAILURE;
                    }
                };
                for message in inspection.messages {
                    match message.envelope {
                        Some(Envelope::GameEventList {
                            event_count,
                            data_bit_length,
                            data_start_bit,
                        }) => {
                            let bits = match extract_network_bits(
                                payload,
                                data_start_bit,
                                data_bit_length as usize,
                            ) {
                                Ok(v) => v,
                                Err(e) => {
                                    eprintln!("event bits: {e}");
                                    return ExitCode::FAILURE;
                                }
                            };
                            if let Err(e) = decoder.register(
                                &bits,
                                data_bit_length as usize,
                                event_count as usize,
                            ) {
                                eprintln!("event schema: {e}");
                                return ExitCode::FAILURE;
                            }
                        }
                        Some(Envelope::GameEvent {
                            data_bit_length,
                            data_start_bit,
                        }) => {
                            let bits = match extract_network_bits(
                                payload,
                                data_start_bit,
                                data_bit_length as usize,
                            ) {
                                Ok(v) => v,
                                Err(e) => {
                                    eprintln!("event bits: {e}");
                                    return ExitCode::FAILURE;
                                }
                            };
                            let event = match decoder.decode(&bits, data_bit_length as usize) {
                                Ok(v) => v,
                                Err(e) => {
                                    eprintln!("event: {e}");
                                    return ExitCode::FAILURE;
                                }
                            };
                            if emitted > 0 {
                                print!(",");
                            }
                            emitted += 1;
                            print!(
                                "[{}, {}, {}, [",
                                frame.tick.map_or(0, |v| v),
                                event.id,
                                json_string(&event.name)
                            );
                            for (i, (name, value)) in event.fields.iter().enumerate() {
                                if i > 0 {
                                    print!(",");
                                }
                                print!("[{},{}]", json_string(name), event_value_json(value));
                            }
                            print!("]]");
                        }
                        _ => {}
                    }
                }
            }
            println!("]}}");
            ExitCode::SUCCESS
        }
        Ok(d) if mode == "schemas" => {
            let Some(payload) = d
                .frames
                .iter()
                .find(|f| f.kind == DemoCommandKind::DataTables)
                .and_then(|f| f.payload)
            else {
                eprintln!("demo has no data tables");
                return ExitCode::FAILURE;
            };
            let schema = match decode_l4d2_data_tables(payload) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("schema error: {e}");
                    return ExitCode::FAILURE;
                }
            };
            let flat = match flatten_server_classes(&schema) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("flatten error: {e}");
                    return ExitCode::FAILURE;
                }
            };
            let string_payload = d
                .frames
                .iter()
                .find(|f| f.kind == DemoCommandKind::StringTables)
                .and_then(|f| f.payload);
            let strings = match string_payload
                .map(|p| decode_string_table_snapshot(p, StringTableLimits::default()))
                .transpose()
            {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("string-table error: {e}");
                    return ExitCode::FAILURE;
                }
            };
            print!(
                "{{\"stage\":\"schemas-v1\",\"consumedBits\":{},\"tables\":[",
                schema.consumed_bits
            );
            for (i, t) in schema.tables.iter().enumerate() {
                if i > 0 {
                    print!(",");
                }
                print!("[{:?},{}]", t.name, t.props.len());
            }
            print!("],\"classes\":[");
            for (i, c) in flat.iter().enumerate() {
                if i > 0 {
                    print!(",");
                }
                print!(
                    "[{}, {:?}, {:?}, [",
                    c.schema.data_table_id, c.schema.class_name, c.schema.data_table_name
                );
                for (j, p) in c.props.iter().enumerate() {
                    if j > 0 {
                        print!(",");
                    }
                    print!("{:?}", p.path);
                }
                print!("]]");
            }
            print!("],\"stringTables\":[");
            if let Some(snapshot) = strings {
                for (i, t) in snapshot.tables.iter().enumerate() {
                    if i > 0 {
                        print!(",");
                    }
                    print!(
                        "[{:?},{},{}]",
                        t.name,
                        t.entries.len(),
                        t.client_entries.len()
                    );
                }
            }
            println!("]}}");
            ExitCode::SUCCESS
        }
        Ok(d) if mode == "network" => {
            print!("{{\"stage\":\"network-v1\",\"frames\":[");
            let mut emitted = 0;
            for f in &d.frames {
                if !matches!(f.kind, DemoCommandKind::Packet | DemoCommandKind::Signon) {
                    continue;
                }
                let Some(payload) = f.payload else { continue };
                let inspection = match inspect_network_payload(payload, NetworkLimits::default()) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("network limit error: {e}");
                        return ExitCode::FAILURE;
                    }
                };
                if emitted > 0 {
                    print!(",");
                }
                emitted += 1;
                print!(
                    "{{\"offset\":{},\"tick\":{},\"complete\":{},\"consumedBits\":{},\"paddingBits\":{},\"messages\":[",
                    f.offset,
                    f.tick.map_or("null".into(), |v| v.to_string()),
                    inspection.complete,
                    inspection.consumed_bits,
                    inspection.trailing_padding_bits
                );
                for (index, message) in inspection.messages.iter().enumerate() {
                    if index > 0 {
                        print!(",");
                    }
                    print!(
                        "[{},\"{}\",{},{},\"{}\"]",
                        message.id,
                        message.name,
                        message.start_bit,
                        message.end_bit.map_or("null".into(), |v| v.to_string()),
                        message.status.as_str()
                    );
                }
                print!("]}}");
            }
            println!("]}}");
            ExitCode::SUCCESS
        }
        Ok(d) => {
            println!(
                "{{\"stage\":\"framing-v1\",\"demoProtocol\":{},\"networkProtocol\":{},\"bytesConsumed\":{},\"stopped\":{},\"frames\":[",
                d.header.demo_protocol, d.header.network_protocol, d.bytes_consumed, d.stopped
            );
            for (i, f) in d.frames.iter().enumerate() {
                if i > 0 {
                    println!(",");
                }
                print!(
                    "{{\"command\":{},\"kind\":\"{}\",\"tick\":{},\"playerSlot\":{},\"offset\":{},\"payloadOffset\":{},\"payloadLength\":{}}}",
                    f.command,
                    f.kind.as_str(),
                    f.tick.map_or("null".into(), |v| v.to_string()),
                    f.player_slot.map_or("null".into(), |v| v.to_string()),
                    f.offset,
                    f.payload_offset.map_or("null".into(), |v| v.to_string()),
                    f.payload.map_or(0, <[u8]>::len)
                );
            }
            println!("]}}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            println!(
                "{{\"stage\":\"framing-v1\",\"error\":{{\"code\":\"{}\",\"offset\":{}}}}}",
                e.code.as_str(),
                e.offset
            );
            ExitCode::FAILURE
        }
    }
}
fn event_value_json(value: &EventValue) -> String {
    match value {
        EventValue::Boolean(v) => v.to_string(),
        EventValue::Number(v) => {
            if v.is_finite() {
                v.to_string()
            } else {
                "null".into()
            }
        }
        EventValue::String(v) => json_string(v),
    }
}
fn json_string(value: &str) -> String {
    let mut out = String::from("\"");
    for c in value.chars() {
        match c {
            '\"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < '\u{20}' => {
                write!(&mut out, "\\u{:04x}", u32::from(c)).expect("writing to string");
            }
            c => out.push(c),
        }
    }
    out.push('\"');
    out
}
fn opt_vec(value: Option<[f64; 3]>) -> String {
    value.map_or_else(
        || "null".into(),
        |v| format!("[{},{},{}]", v[0], v[1], v[2]),
    )
}
