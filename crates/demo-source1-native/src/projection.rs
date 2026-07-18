use crate::data_tables::FlattenedServerClass;
use crate::demo::DemoCommandKind;
use crate::entities::{EntitySnapshot, PropValue, visit_entity_frames_prepared};
use crate::identity::{DisplayIdentity, UserInfoMapping, collect_userinfo_timeline_prepared};
use crate::network::Envelope;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CoreObservation {
    pub player_epoch_id: String,
    pub tick: i32,
    pub entity_index: usize,
    pub position: Option<[f64; 3]>,
    pub eye_angles: Option<[f64; 3]>,
    pub team: Option<f64>,
    pub player_class: Option<String>,
    pub weapon: Option<String>,
    pub l4d2: L4d2PlayerState,
    pub demo_time_seconds: Option<f64>,
    pub compact_provenance: CompactProvenance,
    /// Rehydrated deterministically by the TypeScript adapter from compact
    /// values, availability tags, and the artifact-level property registry.
    #[serde(skip)]
    pub canonical: Option<CanonicalObservation>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct CompactProvenance {
    pub position_form: u8,
    pub position_paths: Vec<String>,
    pub eye_form: u8,
    pub eye_paths: Vec<String>,
    pub team_path: Option<String>,
    pub class_path: Option<String>,
    pub weapon_tag: u8,
    pub weapon_path: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct L4d2PlayerState {
    pub entity_index: usize,
    pub health: Option<f64>,
    pub max_health: Option<f64>,
    pub health_buffer: Option<f64>,
    pub life_state: Option<f64>,
    pub incapacitated: Option<bool>,
    pub ghost: Option<bool>,
    pub versus_team: Option<f64>,
    pub checkpoint_zombie_kills: Option<Vec<f64>>,
    pub checkpoint_revives: Option<f64>,
    pub checkpoint_incaps: Option<f64>,
    pub checkpoint_special_incaps: Option<f64>,
    pub checkpoint_pounces: Option<f64>,
    pub highest_pounce_damage: Option<f64>,
    pub longest_jockey_ride: Option<f64>,
    pub frustration: Option<f64>,
    pub tongue_victim: Option<usize>,
    pub pounce_victim: Option<usize>,
    pub jockey_victim: Option<usize>,
    pub carry_victim: Option<usize>,
    pub pummel_victim: Option<usize>,
    pub loadout: Option<L4d2PlayerLoadout>,
    pub active_weapon_ammo: Option<L4d2ActiveWeaponAmmo>,
    pub counters: BTreeMap<String, f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct L4d2PlayerLoadout {
    pub primary_weapon_id: Option<f64>,
    pub first_aid_slot_id: Option<f64>,
    pub pills_slot_id: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct L4d2ActiveWeaponAmmo {
    pub weapon_class: Option<String>,
    pub primary_ammo_type: Option<f64>,
    pub clip: Option<f64>,
    pub reserve: Option<f64>,
    pub reloading: Option<bool>,
    pub extra_primary_ammo: Option<f64>,
    pub upgraded_ammo_loaded: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct L4d2WitchObservation {
    pub entity_index: usize,
    pub lifetime: u64,
    pub tick: i32,
    pub time_seconds: Option<f64>,
    /// Cell-relative `DT_Witch` origin; this is not a validated world coordinate.
    pub cell_relative_origin: Option<[f64; 3]>,
    pub rage: Option<f64>,
    pub wander_rage: Option<f64>,
    pub burning: Option<bool>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Available<T> {
    pub availability: String,
    pub value: Option<T>,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Provenance {
    pub source: String,
    pub properties: Vec<String>,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CanonicalObservation {
    pub schema_version: u32,
    pub demo_sha256: String,
    pub player_epoch_id: String,
    pub tick: i32,
    pub demo_time_seconds: Available<f64>,
    pub position: Available<[f64; 3]>,
    pub eye_angles: Available<[f64; 3]>,
    pub team: Available<f64>,
    pub player_class: Available<String>,
    pub weapon: Available<String>,
    pub buttons: Available<f64>,
    pub provenance: HashMap<String, Provenance>,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreEpoch {
    pub id: String,
    pub entity_slot: usize,
    pub lifetime: u64,
    pub user_id: Option<i32>,
    pub stable_token: Option<String>,
    pub connected_at_tick: i32,
    pub disconnected_at_tick: Option<i32>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CoreProjection {
    pub demo_sha256: String,
    pub epochs: Vec<CoreEpoch>,
    pub observations: Vec<CoreObservation>,
    pub display_identities: Vec<DisplayIdentity>,
    pub identity_mappings: Vec<UserInfoMapping>,
    pub rejected_identity_entries: usize,
    pub server_info: Option<ServerMetadata>,
    pub match_states: Vec<MatchState>,
    pub witch_observations: Vec<L4d2WitchObservation>,
    pub coverage: ProjectionCoverage,
}
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityCount {
    pub observed: usize,
    pub derived: usize,
    pub unavailable: usize,
}
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionCoverage {
    pub frames_visited: usize,
    pub observations_emitted: usize,
    pub field_availability: BTreeMap<String, AvailabilityCount>,
}
#[derive(Clone, Copy, Debug)]
pub struct ProjectLimits {
    pub max_observations: usize,
    pub max_identity_mappings: usize,
    pub max_match_states: usize,
}
impl Default for ProjectLimits {
    fn default() -> Self {
        Self {
            max_observations: 2_000_000,
            max_identity_mappings: 16_384,
            max_match_states: 100_000,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchState {
    pub tick: i32,
    pub campaign_scores: [Option<f64>; 2],
    pub chapter_scores: [Option<f64>; 2],
    pub survivor_scores: [Option<f64>; 2],
    pub survivor_distances: [Option<f64>; 8],
    pub survivor_death_distances: [Option<f64>; 8],
    pub round_durations: [Option<f64>; 2],
    pub round_number: Option<f64>,
    pub teams_flipped: Option<bool>,
    pub second_half: Option<bool>,
    pub vote_restarting: Option<bool>,
    pub round_setup_time_remaining: Option<f64>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMetadata {
    pub network_protocol: u32,
    pub server_count: u32,
    pub is_source_tv: bool,
    pub dedicated: bool,
    pub max_server_classes: u32,
    pub player_count: u32,
    pub max_clients: u32,
    pub tick_interval_seconds: f64,
    pub platform_code: u32,
}
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::too_many_lines,
    clippy::float_cmp
)]
pub fn project_core(bytes: &[u8], key: &[u8]) -> Result<CoreProjection, String> {
    project_core_with_limits(bytes, key, ProjectLimits::default())
}
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::too_many_lines,
    clippy::float_cmp
)]
pub fn project_core_with_limits(
    bytes: &[u8],
    key: &[u8],
    limits: ProjectLimits,
) -> Result<CoreProjection, String> {
    let mut observations = Vec::new();
    let mut projection = project_core_with_observer(bytes, key, limits, |observation| {
        observations.push(observation);
    })?;
    projection.observations = observations;
    Ok(projection)
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::too_many_lines,
    clippy::float_cmp
)]
pub(crate) fn project_core_with_observer(
    bytes: &[u8],
    key: &[u8],
    limits: ProjectLimits,
    emit_observation: impl FnMut(CoreObservation),
) -> Result<CoreProjection, String> {
    validate_limits(limits)?;
    let prepared = crate::traversal::PreparedDemo::new(bytes).map_err(|error| error.to_string())?;
    project_core_with_observer_prepared(&prepared, key, limits, emit_observation)
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::too_many_lines,
    clippy::float_cmp
)]
pub(crate) fn project_core_with_observer_prepared(
    prepared: &crate::traversal::PreparedDemo<'_>,
    key: &[u8],
    limits: ProjectLimits,
    mut emit_observation: impl FnMut(CoreObservation),
) -> Result<CoreProjection, String> {
    validate_limits(limits)?;
    let hash = prepared.source_sha256();
    let demo_header = &prepared.demo.header;
    let identity_projection = collect_userinfo_timeline_prepared(prepared, key)?;
    if identity_projection.mappings.len() > limits.max_identity_mappings {
        return Err("projection identity mapping limit exceeded".into());
    }
    let identities = &identity_projection.mappings;
    let server_info = read_server_info_prepared(prepared)?;
    let mut by_slot: HashMap<usize, Vec<&UserInfoMapping>> = HashMap::new();
    for identity in identities {
        by_slot
            .entry(identity.entity_index)
            .or_default()
            .push(identity);
    }
    for values in by_slot.values_mut() {
        values.sort_by_key(|v| v.effective_tick.unwrap_or(i32::MIN));
    }
    let (
        mut active,
        mut completed,
        mut registries,
        mut auxiliary_registries,
        mut match_states,
        mut last_match,
        mut witch_observations,
    ) = (
        HashMap::<usize, CoreEpoch>::new(),
        Vec::new(),
        HashMap::<u32, Registry>::new(),
        HashMap::<u32, Registry>::new(),
        Vec::new(),
        None,
        Vec::new(),
    );
    let tick_interval = (demo_header.playback_ticks > 0 && demo_header.playback_time_seconds > 0.0)
        .then(|| {
            f64::from(demo_header.playback_time_seconds) / f64::from(demo_header.playback_ticks)
        });
    let mut limit_error = None;
    let mut frames_visited = 0_usize;
    let mut observations_emitted = 0_usize;
    let mut field_availability = BTreeMap::new();
    visit_entity_frames_prepared(prepared, |tick, engine, frame, classes| {
        if limit_error.is_some() {
            return;
        }
        frames_visited += 1;
        let player_resource = frame
            .entities
            .values()
            .find(|e| e.active && class_name(classes, e) == Some("CTerrorPlayerResource"));
        if let Some(rules) = frame
            .entities
            .values()
            .find(|e| e.active && class_name(classes, e) == Some("CTerrorGameRulesProxy"))
        {
            let Some(class) = usize::try_from(rules.class_id)
                .ok()
                .and_then(|id| classes.get(id))
            else {
                return;
            };
            let indexed = |prefix: &str, count: usize| -> Vec<Option<f64>> {
                (0..count)
                    .map(|i| value_by_suffix(rules, class, &format!("{prefix}.{i:03}")))
                    .collect()
            };
            let campaign = indexed("m_iCampaignScore", 2);
            let chapter = indexed("m_iChapterScore", 2);
            let survivor = indexed("m_iSurvivorScore", 2);
            let distance = indexed("m_iVersusDistancePerSurvivor", 8);
            let death = indexed("m_iVersusSurvivorDeathDistance", 8);
            let duration = indexed("m_flRoundDuration", 2);
            let state = MatchState {
                tick,
                campaign_scores: [campaign[0], campaign[1]],
                chapter_scores: [chapter[0], chapter[1]],
                survivor_scores: [survivor[0], survivor[1]],
                survivor_distances: std::array::from_fn(|i| distance[i]),
                survivor_death_distances: std::array::from_fn(|i| death[i]),
                round_durations: [duration[0], duration[1]],
                round_number: value_by_suffix(rules, class, "m_nRoundNumber"),
                teams_flipped: value_by_suffix(rules, class, "m_bAreTeamsFlipped")
                    .map(|v| v == 1.0),
                second_half: value_by_suffix(rules, class, "m_bInSecondHalfOfRound")
                    .map(|v| v == 1.0),
                vote_restarting: value_by_suffix(rules, class, "m_bIsVersusVoteRestarting")
                    .map(|v| v == 1.0),
                round_setup_time_remaining: player_resource.and_then(|e| {
                    usize::try_from(e.class_id)
                        .ok()
                        .and_then(|id| classes.get(id))
                        .and_then(|class| value_by_suffix(e, class, "m_nRoundSetupTimeRemaining"))
                }),
            };
            let mut signature = state.clone();
            signature.tick = 0;
            if last_match.as_ref() != Some(&signature) {
                last_match = Some(signature);
                match_states.push(state);
                if match_states.len() > limits.max_match_states {
                    limit_error = Some("projection match-state limit exceeded".to_owned());
                    return;
                }
            }
        }
        for witch in frame
            .entities
            .values()
            .filter(|e| e.active && class_name(classes, e) == Some("Witch"))
        {
            let Some(class) = usize::try_from(witch.class_id)
                .ok()
                .and_then(|id| classes.get(id))
            else {
                continue;
            };
            let direct = registries
                .entry(witch.class_id)
                .or_insert_with(|| Registry::new(class));
            witch_observations.push(L4d2WitchObservation {
                entity_index: witch.entity_index,
                lifetime: witch.lifetime,
                tick,
                time_seconds: tick_interval.map(|v| f64::from(engine) * v),
                cell_relative_origin: position(witch, direct),
                rage: number(witch, direct.named("m_rage")),
                wander_rage: number(witch, direct.named("m_wanderrage")),
                burning: number(witch, direct.named("m_bIsBurning")).map(|v| v != 0.0),
            });
        }
        let mut players: Vec<_> = frame
            .entities
            .values()
            .filter(|e| e.active && class_name(classes, e) == Some("CTerrorPlayer"))
            .collect();
        // The TS oracle uses a Map: replacing an entity after a leave/delete moves
        // that slot to the end of iteration order. Lifetime is the stable native
        // equivalent of that insertion order and is required for byte-for-byte
        // observation ordering parity.
        players.sort_by_key(|e| e.lifetime);
        let mut seen = HashSet::new();
        for player in players {
            seen.insert(player.entity_index);
            let replace = active
                .get(&player.entity_index)
                .is_none_or(|v| v.lifetime != player.lifetime);
            if replace {
                if let Some(mut old) = active.remove(&player.entity_index) {
                    old.disconnected_at_tick = Some(tick);
                    completed.push(old);
                }
                let identity = by_slot
                    .get(&player.entity_index)
                    .and_then(|values| {
                        values
                            .iter()
                            .rev()
                            .find(|v| v.effective_tick.unwrap_or(i32::MIN) <= tick)
                    })
                    .copied();
                active.insert(
                    player.entity_index,
                    CoreEpoch {
                        id: format!("{hash}:{}:{}", player.entity_index, player.lifetime),
                        entity_slot: player.entity_index,
                        lifetime: player.lifetime,
                        user_id: identity.and_then(|v| v.user_id),
                        stable_token: identity.and_then(|v| v.stable_identity_token.clone()),
                        connected_at_tick: tick,
                        disconnected_at_tick: None,
                    },
                );
            }
            let Some(epoch) = active.get(&player.entity_index) else {
                limit_error = Some(format!(
                    "player epoch {} disappeared during projection",
                    player.entity_index
                ));
                return;
            };
            let Some(registry) = usize::try_from(player.class_id)
                .ok()
                .and_then(|id| classes.get(id))
            else {
                continue;
            };
            let direct = registries
                .entry(player.class_id)
                .or_insert_with(|| Registry::new(registry));
            let position = position(player, direct);
            let eye_angles = angles(player, direct);
            let team = number(player, direct.team);
            let class = number(player, direct.class).map(class_name_l4d2);
            let weapon_handle = number(player, direct.weapon);
            let weapon = weapon_handle.and_then(|v| {
                let index = (v as u64 & 0x7ff) as usize;
                frame
                    .entities
                    .get(&index)
                    .filter(|e| e.active)
                    .and_then(|e| class_name(classes, e))
                    .map(str::to_owned)
            });
            let l4d2 = project_l4d2_state(
                player,
                player_resource,
                frame,
                classes,
                direct,
                &mut auxiliary_registries,
            );
            let property_path = |index: Option<usize>| {
                index.and_then(|index| registry.props.get(index).map(|prop| prop.path.clone()))
            };
            let (position_form, position_paths) = if array(player, direct.origin, 3).is_some() {
                (1, property_path(direct.origin).into_iter().collect())
            } else if array(player, direct.origin, 2).is_some()
                && number(player, direct.origin_z).is_some()
            {
                (
                    2,
                    [property_path(direct.origin), property_path(direct.origin_z)]
                        .into_iter()
                        .flatten()
                        .collect(),
                )
            } else if position.is_some() {
                (
                    3,
                    [direct.origin_x, direct.origin_y, direct.origin_z]
                        .into_iter()
                        .filter_map(property_path)
                        .collect(),
                )
            } else {
                (0, Vec::new())
            };
            let (eye_form, eye_paths) = if array(player, direct.angles, 3).is_some() {
                (1, property_path(direct.angles).into_iter().collect())
            } else if eye_angles.is_some() {
                let paths: Vec<_> = [direct.pitch, direct.yaw, direct.roll]
                    .into_iter()
                    .filter_map(property_path)
                    .collect();
                (if direct.roll.is_some() { 3 } else { 2 }, paths)
            } else {
                (0, Vec::new())
            };
            let observation = CoreObservation {
                player_epoch_id: epoch.id.clone(),
                tick,
                entity_index: player.entity_index,
                position,
                eye_angles,
                team,
                player_class: class.clone(),
                weapon: weapon.clone(),
                l4d2,
                demo_time_seconds: tick_interval.map(|interval| f64::from(engine) * interval),
                compact_provenance: CompactProvenance {
                    position_form,
                    position_paths,
                    eye_form,
                    eye_paths,
                    team_path: team.and_then(|_| property_path(direct.team)),
                    class_path: class.as_ref().and_then(|_| property_path(direct.class)),
                    weapon_tag: if weapon_handle.is_none() {
                        0
                    } else if weapon.is_none() {
                        1
                    } else {
                        2
                    },
                    weapon_path: weapon.as_ref().and_then(|_| property_path(direct.weapon)),
                },
                canonical: None,
            };
            record_observation_availability(
                &mut field_availability,
                &observation,
                tick_interval.is_some(),
            );
            emit_observation(observation);
            observations_emitted += 1;
            if observations_emitted > limits.max_observations {
                limit_error = Some("projection observation limit exceeded".to_owned());
                return;
            }
        }
        let gone: Vec<_> = active
            .keys()
            .filter(|i| !seen.contains(i))
            .copied()
            .collect();
        for index in gone {
            if let Some(mut old) = active.remove(&index) {
                old.disconnected_at_tick = Some(tick);
                completed.push(old);
            }
        }
    })?;
    if let Some(error) = limit_error {
        return Err(error);
    }
    completed.extend(active.into_values());
    completed.sort_by_key(|v| (v.connected_at_tick, v.entity_slot));
    Ok(CoreProjection {
        demo_sha256: hash,
        epochs: completed,
        observations: Vec::new(),
        display_identities: identity_projection.display_identities,
        identity_mappings: identity_projection.mappings,
        rejected_identity_entries: identity_projection.rejected_entries,
        server_info,
        match_states,
        witch_observations,
        coverage: ProjectionCoverage {
            frames_visited,
            observations_emitted,
            field_availability,
        },
    })
}

fn record_observation_availability(
    field_availability: &mut BTreeMap<String, AvailabilityCount>,
    observation: &CoreObservation,
    has_tick_interval: bool,
) {
    for (name, availability) in [
        (
            "demoTimeSeconds",
            if has_tick_interval {
                "derived"
            } else {
                "unavailable"
            },
        ),
        (
            "position",
            if observation.position.is_some() {
                "observed"
            } else {
                "unavailable"
            },
        ),
        (
            "eyeAngles",
            if observation.eye_angles.is_some() {
                "derived"
            } else {
                "unavailable"
            },
        ),
        (
            "team",
            if observation.team.is_some() {
                "observed"
            } else {
                "unavailable"
            },
        ),
        (
            "playerClass",
            if observation.player_class.is_some() {
                "observed"
            } else {
                "unavailable"
            },
        ),
        (
            "weapon",
            if observation.weapon.is_some() {
                "observed"
            } else {
                "unavailable"
            },
        ),
        ("buttons", "unavailable"),
    ] {
        let count = field_availability.entry(name.to_owned()).or_default();
        match availability {
            "observed" => count.observed += 1,
            "derived" => count.derived += 1,
            _ => count.unavailable += 1,
        }
    }
}
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
#[allow(dead_code)]
fn canonical_observation(
    hash: &str,
    epoch: &str,
    tick: i32,
    engine: u32,
    interval: Option<f64>,
    player: &EntitySnapshot,
    class: &FlattenedServerClass,
    r: &Registry,
    position: Option<[f64; 3]>,
    angles: Option<[f64; 3]>,
    team: Option<f64>,
    player_class: Option<String>,
    weapon: Option<String>,
) -> CanonicalObservation {
    let mut provenance = HashMap::new();
    let path = |index: Option<usize>| {
        index
            .and_then(|i| class.props.get(i))
            .map(|p| vec![p.path.clone()])
            .unwrap_or_default()
    };
    provenance.insert(
        "team".into(),
        prov(
            path(r.team),
            team.is_some(),
            "networked team was unavailable",
        ),
    );
    provenance.insert(
        "playerClass".into(),
        prov(
            path(r.class),
            player_class.is_some(),
            "networked zombie class was unavailable",
        ),
    );
    provenance.insert(
        "weapon".into(),
        prov(
            path(r.weapon),
            weapon.is_some(),
            "active weapon handle did not resolve to an active network entity",
        ),
    );
    let position_paths = if array(player, r.origin, 3).is_some() {
        path(r.origin)
    } else {
        [r.origin_x, r.origin_y, r.origin_z]
            .into_iter()
            .flat_map(path)
            .collect()
    };
    provenance.insert(
        "position".into(),
        prov(
            position_paths,
            position.is_some(),
            "complete networked origin XYZ was unavailable",
        ),
    );
    let angle_paths = if array(player, r.angles, 3).is_some() {
        path(r.angles)
    } else {
        [r.pitch, r.yaw, r.roll]
            .into_iter()
            .flat_map(path)
            .collect()
    };
    provenance.insert("eyeAngles".into(),if angles.is_some()&&r.roll.is_none(){Provenance{source:"derived-network-normalization".into(),properties:angle_paths,reason:Some("L4D2 networks player eye pitch/yaw only; canonical roll is explicitly normalized to zero".into())}}else{prov(angle_paths,angles.is_some(),"networked eye pitch and yaw were unavailable")});
    provenance.insert(
        "buttons".into(),
        Provenance {
            source: "unavailable".into(),
            properties: Vec::new(),
            reason: Some("SourceTV does not contain per-player user-command buttons".into()),
        },
    );
    provenance.insert(
        "demoTimeSeconds".into(),
        if interval.is_some() {
            Provenance {
                source: "derived-engine-tick".into(),
                properties: Vec::new(),
                reason: None,
            }
        } else {
            Provenance {
                source: "unavailable".into(),
                properties: Vec::new(),
                reason: Some("tick interval was not supplied".into()),
            }
        },
    );
    CanonicalObservation {
        schema_version: 1,
        demo_sha256: hash.into(),
        player_epoch_id: epoch.into(),
        tick,
        demo_time_seconds: match interval {
            Some(v) => Available {
                availability: "derived".into(),
                value: Some(f64::from(engine) * v),
                reason: None,
            },
            None => Available {
                availability: "unavailable".into(),
                value: None,
                reason: Some("tick interval was not supplied".into()),
            },
        },
        position: available(position, "complete networked origin XYZ was unavailable"),
        eye_angles: available(angles, "networked eye pitch and yaw were unavailable"),
        team: available(team, "networked team was unavailable"),
        player_class: available(player_class, "networked zombie class was unavailable"),
        weapon: available(
            weapon,
            "active weapon handle did not resolve to an active network entity",
        ),
        buttons: Available {
            availability: "unavailable".into(),
            value: None,
            reason: Some("SourceTV does not contain per-player user-command buttons".into()),
        },
        provenance,
    }
}
#[allow(dead_code)]
fn available<T>(value: Option<T>, reason: &str) -> Available<T> {
    match value {
        Some(v) => Available {
            availability: "observed".into(),
            value: Some(v),
            reason: None,
        },
        None => Available {
            availability: "unavailable".into(),
            value: None,
            reason: Some(reason.into()),
        },
    }
}
#[allow(dead_code)]
fn prov(properties: Vec<String>, present: bool, reason: &str) -> Provenance {
    if present {
        Provenance {
            source: "network-send-property".into(),
            properties,
            reason: None,
        }
    } else {
        Provenance {
            source: "unavailable".into(),
            properties: Vec::new(),
            reason: Some(reason.into()),
        }
    }
}
fn value_by_suffix(e: &EntitySnapshot, class: &FlattenedServerClass, suffix: &str) -> Option<f64> {
    let index = class
        .props
        .iter()
        .position(|p| p.path == suffix || p.path.ends_with(&format!(".{suffix}")))?;
    number(e, Some(index))
}
fn validate_limits(limits: ProjectLimits) -> Result<(), String> {
    if limits.max_observations == 0
        || limits.max_identity_mappings == 0
        || limits.max_match_states == 0
    {
        return Err("projection limits must be positive".into());
    }
    Ok(())
}

fn read_server_info_prepared(
    prepared: &crate::traversal::PreparedDemo<'_>,
) -> Result<Option<ServerMetadata>, String> {
    for (frame_index, frame) in prepared.demo.frames.iter().enumerate() {
        if !matches!(
            frame.kind,
            DemoCommandKind::Signon | DemoCommandKind::Packet
        ) {
            continue;
        }
        let Some(_payload) = frame.payload else {
            continue;
        };
        let inspection = prepared
            .inspection(frame_index)
            .ok_or("missing network inspection")?;
        for message in &inspection.messages {
            if let Some(Envelope::ServerInfo {
                network_protocol,
                server_count,
                is_source_tv,
                dedicated,
                max_server_classes,
                player_count,
                max_clients,
                tick_interval_seconds,
                platform_code,
            }) = &message.envelope
            {
                return Ok(Some(ServerMetadata {
                    network_protocol: *network_protocol,
                    server_count: *server_count,
                    is_source_tv: *is_source_tv,
                    dedicated: *dedicated,
                    max_server_classes: *max_server_classes,
                    player_count: *player_count,
                    max_clients: *max_clients,
                    tick_interval_seconds: f64::from(*tick_interval_seconds),
                    platform_code: *platform_code,
                }));
            }
        }
    }
    Ok(None)
}
fn class_name<'a>(classes: &'a [FlattenedServerClass], e: &EntitySnapshot) -> Option<&'a str> {
    classes
        .get(usize::try_from(e.class_id).ok()?)
        .map(|v| v.schema.class_name.as_str())
}
struct Registry {
    team: Option<usize>,
    class: Option<usize>,
    weapon: Option<usize>,
    origin: Option<usize>,
    origin_x: Option<usize>,
    origin_y: Option<usize>,
    origin_z: Option<usize>,
    angles: Option<usize>,
    pitch: Option<usize>,
    yaw: Option<usize>,
    roll: Option<usize>,
    named: HashMap<String, usize>,
}
impl Registry {
    fn new(c: &FlattenedServerClass) -> Self {
        let find = |suffixes: &[&str]| {
            c.props.iter().position(|p| {
                suffixes
                    .iter()
                    .any(|s| p.path == *s || p.path.ends_with(&format!(".{s}")))
            })
        };
        let named = c
            .props
            .iter()
            .enumerate()
            .flat_map(|(index, prop)| {
                let mut suffixes = vec![prop.path.clone()];
                suffixes.extend(
                    prop.path
                        .match_indices('.')
                        .map(|(offset, _)| prop.path[offset + 1..].to_owned()),
                );
                suffixes.into_iter().map(move |suffix| (suffix, index))
            })
            .fold(HashMap::new(), |mut result, (suffix, index)| {
                result.entry(suffix).or_insert(index);
                result
            });
        Self {
            team: find(&["m_iTeamNum"]),
            class: find(&["m_zombieClass"]),
            weapon: find(&["m_hActiveWeapon"]),
            origin: find(&["m_vecOrigin"]),
            origin_x: find(&["m_vecOrigin[0]", "m_vecOrigin.x"]),
            origin_y: find(&["m_vecOrigin[1]", "m_vecOrigin.y"]),
            origin_z: find(&["m_vecOrigin[2]", "m_vecOrigin.z"]),
            angles: find(&["m_angEyeAngles"]),
            pitch: find(&["m_angEyeAngles[0]", "m_angEyeAngles.0"]),
            yaw: find(&["m_angEyeAngles[1]", "m_angEyeAngles.1"]),
            roll: find(&["m_angEyeAngles[2]", "m_angEyeAngles.2"]),
            named,
        }
    }
    fn named(&self, suffix: &str) -> Option<usize> {
        self.named.get(suffix).copied()
    }
}

pub(crate) const COUNTER_NAMES: [&str; 34] = [
    "m_checkpointSurvivorDamage",
    "m_checkpointMedkitsUsed",
    "m_checkpointPillsUsed",
    "m_checkpointMolotovsUsed",
    "m_checkpointPipebombsUsed",
    "m_checkpointBoomerBilesUsed",
    "m_checkpointAdrenalinesUsed",
    "m_checkpointDefibrillatorsUsed",
    "m_checkpointDamageTaken",
    "m_checkpointFirstAidShared",
    "m_checkpointDamageToTank",
    "m_checkpointDamageToWitch",
    "m_missionAccuracy",
    "m_checkpointHeadshots",
    "m_checkpointHeadshotAccuracy",
    "m_checkpointDeaths",
    "m_checkpointMeleeKills",
    "m_checkpointPZTankDamage",
    "m_checkpointPZHunterDamage",
    "m_checkpointPZSmokerDamage",
    "m_checkpointPZBoomerDamage",
    "m_checkpointPZJockeyDamage",
    "m_checkpointPZSpitterDamage",
    "m_checkpointPZChargerDamage",
    "m_checkpointPZKills",
    "m_checkpointPZPushes",
    "m_checkpointPZTankPunches",
    "m_checkpointPZTankThrows",
    "m_checkpointPZHung",
    "m_checkpointPZPulled",
    "m_checkpointPZBombed",
    "m_checkpointPZVomited",
    "m_checkpointPZLongestSmokerGrab",
    "m_checkpointPZNumChargeVictims",
];

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn project_l4d2_state(
    player: &EntitySnapshot,
    player_resource: Option<&EntitySnapshot>,
    frame: &crate::entities::EntityFrame,
    classes: &[FlattenedServerClass],
    registry: &Registry,
    auxiliary_registries: &mut HashMap<u32, Registry>,
) -> L4d2PlayerState {
    let scalar = |name: &str| number(player, registry.named(name));
    let flag = |name: &str| scalar(name).map(|value| value != 0.0);
    let handle = |name: &str| {
        scalar(name).and_then(|value| {
            let raw = value as u64;
            (raw != 0x1f_ffff).then_some((raw & 0x7ff) as usize)
        })
    };
    let active_weapon = handle("m_hActiveWeapon")
        .and_then(|index| frame.entities.get(&index))
        .filter(|entity| entity.active);
    let active_weapon_ammo = active_weapon.and_then(|weapon| {
        let class = usize::try_from(weapon.class_id)
            .ok()
            .and_then(|id| classes.get(id))?;
        let weapon_registry = auxiliary_registries
            .entry(weapon.class_id)
            .or_insert_with(|| Registry::new(class));
        let weapon_scalar = |name: &str| number(weapon, weapon_registry.named(name));
        let primary_ammo_type = weapon_scalar("m_iPrimaryAmmoType");
        let reserve = primary_ammo_type
            .filter(|value| *value >= 0.0)
            .and_then(|value| scalar(&format!("m_iAmmo.{:03}", value as usize)));
        Some(L4d2ActiveWeaponAmmo {
            weapon_class: Some(class.schema.class_name.clone()),
            primary_ammo_type,
            clip: weapon_scalar("m_iClip1"),
            reserve,
            reloading: weapon_scalar("m_bInReload").map(|value| value != 0.0),
            extra_primary_ammo: weapon_scalar("m_iExtraPrimaryAmmo"),
            upgraded_ammo_loaded: weapon_scalar("m_nUpgradedPrimaryAmmoLoaded"),
        })
    });
    let loadout = player_resource.and_then(|resource| {
        let class = usize::try_from(resource.class_id)
            .ok()
            .and_then(|id| classes.get(id))?;
        let index = auxiliary_registries
            .entry(resource.class_id)
            .or_insert_with(|| Registry::new(class));
        let at = |prefix: &str| {
            number(
                resource,
                index.named(&format!("{prefix}.{:03}", player.entity_index)),
            )
        };
        Some(L4d2PlayerLoadout {
            primary_weapon_id: at("m_primaryWeapon"),
            first_aid_slot_id: at("m_firstAidSlot"),
            pills_slot_id: at("m_pillsSlot"),
        })
    });
    let counters = COUNTER_NAMES
        .into_iter()
        .filter_map(|name| scalar(name).map(|value| (name.to_owned(), value)))
        .collect();
    L4d2PlayerState {
        entity_index: player.entity_index,
        health: scalar("m_iHealth"),
        max_health: scalar("m_iMaxHealth"),
        health_buffer: scalar("m_healthBuffer"),
        life_state: scalar("m_lifeState"),
        incapacitated: flag("m_isIncapacitated"),
        ghost: flag("m_isGhost"),
        versus_team: scalar("m_iVersusTeam"),
        checkpoint_zombie_kills: array(player, registry.named("m_checkpointZombieKills"), 1),
        checkpoint_revives: scalar("m_checkpointReviveOtherCount"),
        checkpoint_incaps: scalar("m_checkpointIncaps"),
        checkpoint_special_incaps: scalar("m_checkpointPZIncaps"),
        checkpoint_pounces: scalar("m_checkpointPZPounces"),
        highest_pounce_damage: scalar("m_checkpointPZHighestDmgPounce"),
        longest_jockey_ride: scalar("m_checkpointPZLongestJockeyRide"),
        frustration: scalar("m_frustration"),
        tongue_victim: handle("m_tongueVictim"),
        pounce_victim: handle("m_pounceVictim"),
        jockey_victim: handle("m_jockeyVictim"),
        carry_victim: handle("m_carryVictim"),
        pummel_victim: handle("m_pummelVictim"),
        loadout,
        active_weapon_ammo,
        counters,
    }
}
fn number(e: &EntitySnapshot, index: Option<usize>) -> Option<f64> {
    match e.properties.get(index?)?.as_ref()? {
        PropValue::Number(v) => Some(*v),
        _ => None,
    }
}
fn array(e: &EntitySnapshot, index: Option<usize>, min: usize) -> Option<Vec<f64>> {
    match e.properties.get(index?)?.as_ref()? {
        PropValue::Array(v) if v.len() >= min => v
            .iter()
            .map(|x| match x {
                PropValue::Number(n) => Some(*n),
                _ => None,
            })
            .collect(),
        _ => None,
    }
}
fn position(e: &EntitySnapshot, c: &Registry) -> Option<[f64; 3]> {
    if let Some(v) = array(e, c.origin, 3) {
        return Some([v[0], v[1], v[2]]);
    }
    let xy = array(e, c.origin, 2);
    let z = number(e, c.origin_z);
    if let (Some(v), Some(z)) = (xy, z) {
        return Some([v[0], v[1], z]);
    }
    Some([number(e, c.origin_x)?, number(e, c.origin_y)?, z?])
}
fn angles(e: &EntitySnapshot, c: &Registry) -> Option<[f64; 3]> {
    if let Some(v) = array(e, c.angles, 3) {
        return Some([v[0], v[1], v[2]]);
    }
    let pitch = number(e, c.pitch)?;
    let yaw = number(e, c.yaw)?;
    Some([pitch, yaw, number(e, c.roll).unwrap_or(0.0)])
}
#[allow(clippy::cast_possible_truncation)]
fn class_name_l4d2(value: f64) -> String {
    match value as i32 {
        1 => "Smoker",
        2 => "Boomer",
        3 => "Hunter",
        4 => "Spitter",
        5 => "Jockey",
        6 => "Charger",
        7 => "Witch",
        8 => "Tank",
        9 => "Survivor",
        _ => return format!("zombie-class:{value}"),
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data_tables::{FlattenedSendProp, SendPropSchema, ServerClassSchema};
    use std::sync::Arc;

    #[test]
    fn rejects_zero_projection_limits_before_parsing() {
        let error = project_core_with_limits(
            &[],
            b"0123456789abcdef",
            ProjectLimits {
                max_observations: 0,
                ..ProjectLimits::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("positive"));
    }

    #[test]
    fn registry_preserves_typescript_first_suffix_match() {
        let prop = |path: &str| FlattenedSendProp {
            path: path.to_owned(),
            prop: SendPropSchema {
                prop_type: 0,
                name: path.to_owned(),
                flags: 0,
                priority: 0,
                data_table_name: None,
                low_value: None,
                high_value: None,
                bit_count: None,
                array_elements: None,
            },
            array_element: None,
        };
        let class = FlattenedServerClass {
            schema: ServerClassSchema {
                data_table_id: 0,
                class_name: "CTerrorPlayer".into(),
                data_table_name: "DT_TerrorPlayer".into(),
            },
            props: vec![prop("base.m_iHealth"), prop("other.m_iHealth")],
        };
        let registry = Registry::new(&class);
        assert_eq!(registry.named("m_iHealth"), Some(0));
    }

    #[test]
    fn checkpoint_zombie_kills_retains_the_complete_numeric_array() {
        let entity = EntitySnapshot {
            entity_index: 1,
            class_id: 0,
            serial: 0,
            lifetime: 1,
            active: true,
            properties: Arc::new(vec![Some(PropValue::Array(vec![
                PropValue::Number(2.0),
                PropValue::Number(3.0),
                PropValue::Number(5.0),
            ]))]),
        };
        assert_eq!(array(&entity, Some(0), 1), Some(vec![2.0, 3.0, 5.0]));
    }
}
