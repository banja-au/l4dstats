//! Compact, borrowed JSON wire rows for projected player observations.
//!
//! The positional layout is deliberately versioned by constants in this module.
//! A cleared L4D2 presence bit means that no value is present in the row at all;
//! it is distinct from `null` inside the fixed-order loadout, ammo, and counter
//! arrays.

use crate::projection::{CoreObservation, CoreProjection, L4d2PlayerState};
use serde::ser::{SerializeSeq, SerializeStruct};
use serde::{Serialize, Serializer};
use std::collections::{BTreeSet, HashMap};

pub const OBSERVATION_ROW_FIELDS: [&str; 10] = [
    "epochIndex",
    "tick",
    "entityIndex",
    "position",
    "eyeAngles",
    "team",
    "playerClassStringIndex",
    "weaponStringIndex",
    "l4d2",
    "provenance",
];

pub const L4D2_OPTIONAL_FIELDS: [&str; 22] = [
    "health",
    "maxHealth",
    "healthBuffer",
    "lifeState",
    "incapacitated",
    "ghost",
    "versusTeam",
    "checkpointZombieKills",
    "checkpointRevives",
    "checkpointIncaps",
    "checkpointSpecialIncaps",
    "checkpointPounces",
    "highestPounceDamage",
    "longestJockeyRide",
    "frustration",
    "tongueVictim",
    "pounceVictim",
    "jockeyVictim",
    "carryVictim",
    "pummelVictim",
    "loadout",
    "activeWeaponAmmo",
];

pub const LOADOUT_ROW_FIELDS: [&str; 3] = ["primaryWeaponId", "firstAidSlotId", "pillsSlotId"];

pub const ACTIVE_WEAPON_AMMO_ROW_FIELDS: [&str; 7] = [
    "weaponClassStringIndex",
    "primaryAmmoType",
    "clip",
    "reserve",
    "reloading",
    "extraPrimaryAmmo",
    "upgradedAmmoLoaded",
];

/// Small owned indexes plus borrowed observation data. Constructing this type
/// never clones the high-volume projection observations or L4D2 state.
pub struct CompactObservations<'a> {
    projection: &'a CoreProjection,
    epochs: Vec<&'a str>,
    epoch_indexes: HashMap<&'a str, usize>,
    strings: Vec<&'a str>,
    string_indexes: HashMap<&'a str, usize>,
    counters: Vec<&'a str>,
}

impl<'a> CompactObservations<'a> {
    #[must_use]
    pub fn new(projection: &'a CoreProjection) -> Self {
        let epochs: Vec<_> = projection
            .epochs
            .iter()
            .map(|epoch| epoch.id.as_str())
            .collect();
        let epoch_indexes = epochs
            .iter()
            .enumerate()
            .map(|(i, value)| (*value, i))
            .collect();

        let mut strings = Vec::new();
        let mut string_indexes = HashMap::new();
        for observation in &projection.observations {
            for value in [
                observation.player_class.as_deref(),
                observation.weapon.as_deref(),
                observation
                    .l4d2
                    .active_weapon_ammo
                    .as_ref()
                    .and_then(|ammo| ammo.weapon_class.as_deref()),
            ]
            .into_iter()
            .flatten()
            {
                if !string_indexes.contains_key(value) {
                    string_indexes.insert(value, strings.len());
                    strings.push(value);
                }
            }
        }
        let counter_set: BTreeSet<_> = projection
            .observations
            .iter()
            .flat_map(|observation| observation.l4d2.counters.keys().map(String::as_str))
            .collect();
        Self {
            projection,
            epochs,
            epoch_indexes,
            strings,
            string_indexes,
            counters: counter_set.into_iter().collect(),
        }
    }
}

impl Serialize for CompactObservations<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("CompactObservations", 4)?;
        state.serialize_field("epochs", &self.epochs)?;
        state.serialize_field("strings", &self.strings)?;
        state.serialize_field("counters", &self.counters)?;
        state.serialize_field("rows", &ObservationRows { wire: self })?;
        state.end()
    }
}

struct ObservationRows<'a> {
    wire: &'a CompactObservations<'a>,
}
impl Serialize for ObservationRows<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut rows = serializer.serialize_seq(Some(self.wire.projection.observations.len()))?;
        for observation in &self.wire.projection.observations {
            rows.serialize_element(&ObservationRow {
                observation,
                wire: self.wire,
            })?;
        }
        rows.end()
    }
}

struct ObservationRow<'a> {
    observation: &'a CoreObservation,
    wire: &'a CompactObservations<'a>,
}
impl Serialize for ObservationRow<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let value = self.observation;
        let mut row = serializer.serialize_seq(Some(OBSERVATION_ROW_FIELDS.len()))?;
        let epoch_index = self
            .wire
            .epoch_indexes
            .get(value.player_epoch_id.as_str())
            .copied();
        row.serialize_element(&epoch_index)?;
        row.serialize_element(&value.tick)?;
        row.serialize_element(&value.entity_index)?;
        row.serialize_element(&value.position)?;
        row.serialize_element(&value.eye_angles)?;
        row.serialize_element(&value.team)?;
        row.serialize_element(
            &value
                .player_class
                .as_deref()
                .and_then(|v| self.wire.string_indexes.get(v)),
        )?;
        row.serialize_element(
            &value
                .weapon
                .as_deref()
                .and_then(|v| self.wire.string_indexes.get(v)),
        )?;
        row.serialize_element(&L4d2Row {
            value: &value.l4d2,
            wire: self.wire,
        })?;
        row.end()
    }
}

struct L4d2Row<'a> {
    value: &'a L4d2PlayerState,
    wire: &'a CompactObservations<'a>,
}
impl Serialize for L4d2Row<'_> {
    #[allow(clippy::too_many_lines)]
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let v = self.value;
        let present = [
            v.health.is_some(),
            v.max_health.is_some(),
            v.health_buffer.is_some(),
            v.life_state.is_some(),
            v.incapacitated.is_some(),
            v.ghost.is_some(),
            v.versus_team.is_some(),
            v.checkpoint_zombie_kills.is_some(),
            v.checkpoint_revives.is_some(),
            v.checkpoint_incaps.is_some(),
            v.checkpoint_special_incaps.is_some(),
            v.checkpoint_pounces.is_some(),
            v.highest_pounce_damage.is_some(),
            v.longest_jockey_ride.is_some(),
            v.frustration.is_some(),
            v.tongue_victim.is_some(),
            v.pounce_victim.is_some(),
            v.jockey_victim.is_some(),
            v.carry_victim.is_some(),
            v.pummel_victim.is_some(),
            v.loadout.is_some(),
            v.active_weapon_ammo.is_some(),
        ];
        let mask =
            present.iter().enumerate().fold(
                0_u32,
                |mask, (bit, set)| {
                    if *set { mask | (1_u32 << bit) } else { mask }
                },
            );
        let mut row = serializer.serialize_seq(None)?;
        row.serialize_element(&v.entity_index)?;
        row.serialize_element(&mask)?;
        macro_rules! optional {
            ($field:expr) => {
                if let Some(value) = $field {
                    row.serialize_element(value)?;
                }
            };
        }
        optional!(&v.health);
        optional!(&v.max_health);
        optional!(&v.health_buffer);
        optional!(&v.life_state);
        optional!(&v.incapacitated);
        optional!(&v.ghost);
        optional!(&v.versus_team);
        optional!(&v.checkpoint_zombie_kills);
        optional!(&v.checkpoint_revives);
        optional!(&v.checkpoint_incaps);
        optional!(&v.checkpoint_special_incaps);
        optional!(&v.checkpoint_pounces);
        optional!(&v.highest_pounce_damage);
        optional!(&v.longest_jockey_ride);
        optional!(&v.frustration);
        optional!(&v.tongue_victim);
        optional!(&v.pounce_victim);
        optional!(&v.jockey_victim);
        optional!(&v.carry_victim);
        optional!(&v.pummel_victim);
        if let Some(loadout) = &v.loadout {
            row.serialize_element(&(
                loadout.primary_weapon_id,
                loadout.first_aid_slot_id,
                loadout.pills_slot_id,
            ))?;
        }
        if let Some(ammo) = &v.active_weapon_ammo {
            let class = ammo
                .weapon_class
                .as_deref()
                .and_then(|name| self.wire.string_indexes.get(name))
                .copied();
            row.serialize_element(&(
                class,
                ammo.primary_ammo_type,
                ammo.clip,
                ammo.reserve,
                ammo.reloading,
                ammo.extra_primary_ammo,
                ammo.upgraded_ammo_loaded,
            ))?;
        }
        let counters: Vec<_> = self
            .wire
            .counters
            .iter()
            .map(|name| v.counters.get(*name).copied())
            .collect();
        row.serialize_element(&counters)?;
        row.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::{CoreEpoch, L4d2PlayerLoadout, ProjectionCoverage};
    use std::collections::BTreeMap;

    fn empty_l4d2(entity_index: usize) -> L4d2PlayerState {
        L4d2PlayerState {
            entity_index,
            health: None,
            max_health: None,
            health_buffer: None,
            life_state: None,
            incapacitated: None,
            ghost: None,
            versus_team: None,
            checkpoint_zombie_kills: None,
            checkpoint_revives: None,
            checkpoint_incaps: None,
            checkpoint_special_incaps: None,
            checkpoint_pounces: None,
            highest_pounce_damage: None,
            longest_jockey_ride: None,
            frustration: None,
            tongue_victim: None,
            pounce_victim: None,
            jockey_victim: None,
            carry_victim: None,
            pummel_victim: None,
            loadout: None,
            active_weapon_ammo: None,
            counters: BTreeMap::new(),
        }
    }

    #[test]
    fn bitmap_omits_missing_fields_but_fixed_rows_retain_nulls() {
        let mut first = empty_l4d2(1);
        first.health = Some(0.0);
        first.loadout = Some(L4d2PlayerLoadout {
            primary_weapon_id: None,
            first_aid_slot_id: Some(2.0),
            pills_slot_id: None,
        });
        first.counters.insert("a".into(), 1.0);
        let mut second = empty_l4d2(2);
        second.counters.insert("b".into(), 3.0);
        let projection = CoreProjection {
            demo_sha256: "hash".into(),
            epochs: vec![CoreEpoch {
                id: "epoch".into(),
                entity_slot: 1,
                lifetime: 1,
                user_id: None,
                stable_token: None,
                connected_at_tick: 0,
                disconnected_at_tick: None,
            }],
            observations: vec![
                CoreObservation {
                    player_epoch_id: "epoch".into(),
                    tick: 10,
                    entity_index: 1,
                    position: None,
                    eye_angles: None,
                    team: None,
                    player_class: None,
                    weapon: None,
                    l4d2: first,
                    demo_time_seconds: None,
                    compact_provenance: crate::projection::CompactProvenance::default(),
                    canonical: None,
                },
                CoreObservation {
                    player_epoch_id: "epoch".into(),
                    tick: 11,
                    entity_index: 2,
                    position: None,
                    eye_angles: None,
                    team: None,
                    player_class: None,
                    weapon: None,
                    l4d2: second,
                    demo_time_seconds: None,
                    compact_provenance: crate::projection::CompactProvenance::default(),
                    canonical: None,
                },
            ],
            display_identities: vec![],
            identity_mappings: vec![],
            rejected_identity_entries: 0,
            server_info: None,
            match_states: vec![],
            witch_observations: vec![],
            coverage: ProjectionCoverage::default(),
        };
        let json = serde_json::to_value(CompactObservations::new(&projection)).unwrap();
        assert_eq!(json["counters"], serde_json::json!(["a", "b"]));
        assert_eq!(
            json["rows"][0][8],
            serde_json::json!([
                1,
                (1_u32 << 0) | (1_u32 << 20),
                0.0,
                [null, 2.0, null],
                [1.0, null]
            ])
        );
        assert_eq!(json["rows"][1][8], serde_json::json!([2, 0, [null, 3.0]]));
    }
}
