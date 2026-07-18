use crate::demo::DemoCommandKind;
use crate::network::{Envelope, extract_network_bits};
use crate::string_tables::{
    DemoStringTable, NetworkStringTableChange, NetworkStringTableSchema, StringTableLimits,
    UserInfoIdentity, decode_l4d2_user_info, decode_network_string_table_changes,
    decode_string_table_snapshot, unwrap_l4d2_string_table_data,
};
use crate::traversal::PreparedDemo;
use hmac::{Hmac, KeyInit, Mac};
use serde::Serialize;
use sha2::Sha256;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserInfoMapping {
    pub entity_index: usize,
    pub user_info_slot: usize,
    pub user_id: Option<i32>,
    pub effective_tick: Option<i32>,
    pub stable_identity_token: Option<String>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayIdentity {
    pub entity_index: usize,
    pub user_info_slot: usize,
    pub user_id: i32,
    pub effective_tick: Option<i32>,
    pub display_name: String,
    pub fake_player: bool,
    pub steam_id64: Option<String>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityProjection {
    pub mappings: Vec<UserInfoMapping>,
    pub display_identities: Vec<DisplayIdentity>,
    pub rejected_entries: usize,
}
pub fn stable_token(steam_id: u64, key: &[u8]) -> Result<String, String> {
    if key.len() < 16 {
        return Err("pseudonymKey must contain at least 16 bytes".into());
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| "invalid pseudonym key")?;
    mac.update(steam_id.to_string().as_bytes());
    Ok(format!(
        "hmac-sha256:{}",
        hex::encode(mac.finalize().into_bytes())
    ))
}
pub fn project_userinfo_snapshot(
    table: Option<&DemoStringTable>,
    key: &[u8],
) -> Result<IdentityProjection, String> {
    if key.len() < 16 {
        return Err("pseudonymKey must contain at least 16 bytes".into());
    }
    let Some(table) = table.filter(|t| t.name == "userinfo") else {
        return Ok(IdentityProjection {
            mappings: Vec::new(),
            display_identities: Vec::new(),
            rejected_entries: 0,
        });
    };
    let mut output = IdentityProjection {
        mappings: Vec::new(),
        display_identities: Vec::new(),
        rejected_entries: 0,
    };
    for (slot, entry) in table.entries.iter().enumerate() {
        let Some(data) = entry.data.as_deref() else {
            continue;
        };
        match decode_l4d2_user_info(data) {
            Ok(identity) => append(&mut output, slot, None, identity, key)?,
            Err(_) => output.rejected_entries += 1,
        }
    }
    Ok(output)
}
fn append(
    output: &mut IdentityProjection,
    slot: usize,
    tick: Option<i32>,
    identity: UserInfoIdentity,
    key: &[u8],
) -> Result<(), String> {
    let token = if !identity.fake_player && identity.steam_id64 != 0 {
        Some(stable_token(identity.steam_id64, key)?)
    } else {
        None
    };
    output.mappings.push(UserInfoMapping {
        entity_index: slot + 1,
        user_info_slot: slot,
        user_id: Some(identity.user_id),
        effective_tick: tick,
        stable_identity_token: token,
    });
    output.display_identities.push(DisplayIdentity {
        entity_index: slot + 1,
        user_info_slot: slot,
        user_id: identity.user_id,
        effective_tick: tick,
        display_name: identity.display_name,
        fake_player: identity.fake_player,
        steam_id64: if !identity.fake_player && identity.steam_id64 != 0 {
            Some(identity.steam_id64.to_string())
        } else {
            None
        },
    });
    Ok(())
}

#[allow(clippy::too_many_lines)]
pub fn collect_userinfo_timeline(bytes: &[u8], key: &[u8]) -> Result<IdentityProjection, String> {
    let prepared = PreparedDemo::new(bytes).map_err(|error| error.to_string())?;
    collect_userinfo_timeline_prepared(&prepared, key)
}

#[allow(clippy::too_many_lines)]
pub(crate) fn collect_userinfo_timeline_prepared(
    prepared: &PreparedDemo<'_>,
    key: &[u8],
) -> Result<IdentityProjection, String> {
    if key.len() < 16 {
        return Err("pseudonymKey must contain at least 16 bytes".into());
    }
    let demo = &prepared.demo;
    let snapshot = demo
        .frames
        .iter()
        .find(|f| f.kind == DemoCommandKind::StringTables)
        .and_then(|f| f.payload)
        .map(|p| decode_string_table_snapshot(p, StringTableLimits::default()))
        .transpose()?;
    let initial = project_userinfo_snapshot(
        snapshot
            .as_ref()
            .and_then(|s| s.tables.iter().find(|t| t.name == "userinfo")),
        key,
    )?;
    let mut dynamic = IdentityProjection {
        mappings: Vec::new(),
        display_identities: Vec::new(),
        rejected_entries: initial.rejected_entries,
    };
    let (mut schemas, mut touched) = (Vec::<DynamicSchema>::new(), HashSet::new());
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
        let inspection = prepared
            .inspection(frame_index)
            .ok_or("missing network inspection")?;
        for message in &inspection.messages {
            match &message.envelope {
                Some(Envelope::CreateStringTable {
                    table_name,
                    max_entries,
                    entry_count,
                    data_bit_length,
                    user_data_fixed_size,
                    user_data_size_bits,
                    data_compressed,
                    data_start_bit,
                    ..
                }) => {
                    let mut schema = DynamicSchema {
                        name: table_name.clone(),
                        max_entries: usize::try_from(*max_entries).expect("16-bit value"),
                        user_data_fixed_size: *user_data_fixed_size,
                        user_data_size_bits: user_data_size_bits
                            .map(|v| usize::try_from(v).expect("4-bit value")),
                        existing_names: HashMap::new(),
                    };
                    if schema.name == "userinfo" {
                        let raw = extract_network_bits(
                            payload,
                            *data_start_bit,
                            usize::try_from(*data_bit_length).expect("21-bit value"),
                        )?;
                        let nested =
                            unwrap_l4d2_string_table_data(&raw, *data_compressed, 1_048_576)?;
                        let bits = if *data_compressed {
                            nested.len() * 8
                        } else {
                            usize::try_from(*data_bit_length).expect("21-bit value")
                        };
                        let changes = decode_network_string_table_changes(
                            &nested,
                            bits,
                            usize::try_from(*entry_count).expect("16-bit value"),
                            &schema.view(),
                        )?;
                        apply_changes(
                            changes,
                            &mut schema,
                            frame.tick.unwrap_or(0),
                            key,
                            &mut dynamic,
                            false,
                            false,
                            &mut touched,
                        )?;
                    }
                    schemas.push(schema);
                }
                Some(Envelope::UpdateStringTable {
                    table_id,
                    changed_entries,
                    data_bit_length,
                    data_start_bit,
                }) => {
                    let Some(schema) =
                        schemas.get_mut(usize::try_from(*table_id).expect("5-bit value"))
                    else {
                        continue;
                    };
                    if schema.name != "userinfo" {
                        continue;
                    }
                    let bits = usize::try_from(*data_bit_length).expect("20-bit value");
                    let raw = extract_network_bits(payload, *data_start_bit, bits)?;
                    let changes = decode_network_string_table_changes(
                        &raw,
                        bits,
                        usize::try_from(*changed_entries).expect("16-bit value"),
                        &schema.view(),
                    )?;
                    apply_changes(
                        changes,
                        schema,
                        frame.tick.unwrap_or(0),
                        key,
                        &mut dynamic,
                        true,
                        true,
                        &mut touched,
                    )?;
                }
                _ => {}
            }
        }
    }
    let mut mappings: Vec<_> = initial
        .mappings
        .into_iter()
        .filter(|v| !touched.contains(&v.user_info_slot))
        .map(|mut v| {
            v.effective_tick = Some(0);
            v
        })
        .chain(dynamic.mappings)
        .collect();
    dedup_mappings(&mut mappings);
    let mut display: Vec<_> = initial
        .display_identities
        .into_iter()
        .filter(|v| !touched.contains(&v.user_info_slot))
        .map(|mut v| {
            v.effective_tick = Some(0);
            v
        })
        .chain(dynamic.display_identities)
        .collect();
    dedup_display(&mut display);
    Ok(IdentityProjection {
        mappings,
        display_identities: display,
        rejected_entries: dynamic.rejected_entries,
    })
}
struct DynamicSchema {
    name: String,
    max_entries: usize,
    user_data_fixed_size: bool,
    user_data_size_bits: Option<usize>,
    existing_names: HashMap<usize, String>,
}
impl DynamicSchema {
    fn view(&self) -> NetworkStringTableSchema<'_> {
        NetworkStringTableSchema {
            max_entries: self.max_entries,
            user_data_fixed_size: self.user_data_fixed_size,
            user_data_size_bits: self.user_data_size_bits,
            existing_names: Some(&self.existing_names),
        }
    }
}
#[allow(clippy::too_many_arguments)]
fn apply_changes(
    changes: Vec<NetworkStringTableChange>,
    schema: &mut DynamicSchema,
    tick: i32,
    key: &[u8],
    out: &mut IdentityProjection,
    clear_missing: bool,
    emit: bool,
    touched: &mut HashSet<usize>,
) -> Result<(), String> {
    for change in changes {
        if let Some(name) = change.name {
            schema.existing_names.insert(change.entry_index, name);
        }
        if emit {
            touched.insert(change.entry_index);
        }
        let Some(data) = change.data else {
            if emit && clear_missing {
                out.mappings.push(UserInfoMapping {
                    entity_index: change.entry_index + 1,
                    user_info_slot: change.entry_index,
                    user_id: None,
                    effective_tick: Some(tick),
                    stable_identity_token: None,
                });
            }
            continue;
        };
        if !emit {
            continue;
        }
        match decode_l4d2_user_info(&data) {
            Ok(identity) => append(out, change.entry_index, Some(tick), identity, key)?,
            Err(_) => out.rejected_entries += 1,
        }
    }
    Ok(())
}
fn dedup_mappings(values: &mut Vec<UserInfoMapping>) {
    let mut keys = HashMap::new();
    let mut out = Vec::new();
    for value in values.drain(..) {
        let key = (value.entity_index, value.effective_tick);
        if let Some(&index) = keys.get(&key) {
            out[index] = value;
        } else {
            keys.insert(key, out.len());
            out.push(value);
        }
    }
    *values = out;
}
fn dedup_display(values: &mut Vec<DisplayIdentity>) {
    let mut keys = HashMap::new();
    let mut out = Vec::new();
    for value in values.drain(..) {
        let key = (value.entity_index, value.effective_tick);
        if let Some(&index) = keys.get(&key) {
            out[index] = value;
        } else {
            keys.insert(key, out.len());
            out.push(value);
        }
    }
    *values = out;
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn token_matches_known_hmac() {
        assert_eq!(
            stable_token(1, b"0123456789abcdef").unwrap(),
            "hmac-sha256:6f51b61a3db920f1cbe06a4c38501bc0b002ebaf9ceab835ca0a6f899817de7a"
        );
    }
    #[test]
    fn weak_keys_fail() {
        assert!(stable_token(1, b"short").is_err());
    }
}
