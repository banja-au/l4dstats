//! Direct compact-row projection which never retains keyed core observations.

use crate::projection::{
    COUNTER_NAMES, CoreObservation, CoreProjection, L4d2ActiveWeaponAmmo, L4d2PlayerLoadout,
    ProjectLimits, project_core_with_observer,
};
use crate::wire::{L4D2_OPTIONAL_FIELDS, OBSERVATION_ROW_FIELDS};
use serde::ser::{SerializeSeq, SerializeStruct};
use serde::{Serialize, Serializer};
use std::collections::HashMap;

#[derive(Debug)]
pub struct DirectCompactProjection {
    pub projection: CoreProjection,
    pub observations: DirectCompactObservations,
}

#[derive(Debug)]
pub struct DirectCompactObservations {
    epochs: Vec<String>,
    epoch_indexes: HashMap<String, usize>,
    strings: Vec<String>,
    string_indexes: HashMap<String, usize>,
    property_paths: Vec<String>,
    property_path_indexes: HashMap<String, usize>,
    counters_present: [bool; COUNTER_NAMES.len()],
    last_l4d2_by_epoch: HashMap<usize, DirectL4d2Row>,
    rows: Vec<DirectObservationRow>,
}

impl Default for DirectCompactObservations {
    fn default() -> Self {
        Self {
            epochs: Vec::new(),
            epoch_indexes: HashMap::new(),
            strings: Vec::new(),
            string_indexes: HashMap::new(),
            property_paths: Vec::new(),
            property_path_indexes: HashMap::new(),
            counters_present: [false; COUNTER_NAMES.len()],
            last_l4d2_by_epoch: HashMap::new(),
            rows: Vec::new(),
        }
    }
}

#[derive(Debug)]
struct DirectObservationRow {
    epoch_index: usize,
    tick: i32,
    entity_index: usize,
    position: Option<[f64; 3]>,
    eye_angles: Option<[f64; 3]>,
    team: Option<f64>,
    player_class: Option<usize>,
    weapon: Option<usize>,
    l4d2: DirectL4d2Row,
    repeats_l4d2: bool,
    demo_time_seconds: Option<f64>,
    provenance: DirectProvenance,
}

#[derive(Debug)]
struct DirectProvenance {
    position_form: u8,
    position_paths: Vec<usize>,
    eye_form: u8,
    eye_paths: Vec<usize>,
    team_path: Option<usize>,
    class_path: Option<usize>,
    weapon_tag: u8,
    weapon_path: Option<usize>,
}

#[derive(Clone, Debug, PartialEq)]
struct DirectL4d2Row {
    entity_index: usize,
    values: crate::projection::L4d2PlayerState,
    ammo_class: Option<usize>,
    counter_values: [Option<f64>; COUNTER_NAMES.len()],
}

/// Projects entity frames and moves every observation into positional storage
/// as it is emitted. The returned metadata projection deliberately has an empty
/// `observations` vector.
pub fn project_direct_compact(
    bytes: &[u8],
    key: &[u8],
    limits: ProjectLimits,
) -> Result<DirectCompactProjection, String> {
    let mut observations = DirectCompactObservations::default();
    let projection = project_core_with_observer(bytes, key, limits, |row| {
        observations.push(row);
    })?;
    debug_assert!(projection.observations.is_empty());
    Ok(DirectCompactProjection {
        projection,
        observations,
    })
}

pub(crate) fn project_direct_compact_prepared(
    prepared: &crate::traversal::PreparedDemo<'_>,
    key: &[u8],
    limits: ProjectLimits,
) -> Result<DirectCompactProjection, String> {
    let mut observations = DirectCompactObservations::default();
    let projection =
        crate::projection::project_core_with_observer_prepared(prepared, key, limits, |row| {
            observations.push(row);
        })?;
    Ok(DirectCompactProjection {
        projection,
        observations,
    })
}

impl DirectCompactObservations {
    fn intern_string(&mut self, value: String) -> usize {
        if let Some(index) = self.string_indexes.get(value.as_str()) {
            return *index;
        }
        let index = self.strings.len();
        self.string_indexes.insert(value.clone(), index);
        self.strings.push(value);
        index
    }

    fn intern_property_path(&mut self, value: String) -> usize {
        if let Some(index) = self.property_path_indexes.get(value.as_str()) {
            return *index;
        }
        let index = self.property_paths.len();
        self.property_path_indexes.insert(value.clone(), index);
        self.property_paths.push(value);
        index
    }

    fn push(&mut self, mut value: CoreObservation) {
        let epoch_index =
            if let Some(index) = self.epoch_indexes.get(value.player_epoch_id.as_str()) {
                *index
            } else {
                let index = self.epochs.len();
                self.epoch_indexes
                    .insert(value.player_epoch_id.clone(), index);
                self.epochs.push(std::mem::take(&mut value.player_epoch_id));
                index
            };
        let player_class = value.player_class.take().map(|v| self.intern_string(v));
        let weapon = value.weapon.take().map(|v| self.intern_string(v));
        let ammo_class = value
            .l4d2
            .active_weapon_ammo
            .as_mut()
            .and_then(|ammo| ammo.weapon_class.take())
            .map(|v| self.intern_string(v));
        let counter_values = std::array::from_fn(|index| {
            let value = value.l4d2.counters.remove(COUNTER_NAMES[index]);
            self.counters_present[index] |= value.is_some();
            value
        });
        let provenance = DirectProvenance {
            position_form: value.compact_provenance.position_form,
            position_paths: std::mem::take(&mut value.compact_provenance.position_paths)
                .into_iter()
                .map(|path| self.intern_property_path(path))
                .collect(),
            eye_form: value.compact_provenance.eye_form,
            eye_paths: std::mem::take(&mut value.compact_provenance.eye_paths)
                .into_iter()
                .map(|path| self.intern_property_path(path))
                .collect(),
            team_path: value
                .compact_provenance
                .team_path
                .take()
                .map(|path| self.intern_property_path(path)),
            class_path: value
                .compact_provenance
                .class_path
                .take()
                .map(|path| self.intern_property_path(path)),
            weapon_tag: value.compact_provenance.weapon_tag,
            weapon_path: value
                .compact_provenance
                .weapon_path
                .take()
                .map(|path| self.intern_property_path(path)),
        };
        let l4d2 = DirectL4d2Row {
            entity_index: value.l4d2.entity_index,
            values: value.l4d2,
            ammo_class,
            counter_values,
        };
        let repeats_l4d2 = self.last_l4d2_by_epoch.get(&epoch_index) == Some(&l4d2);
        if !repeats_l4d2 {
            self.last_l4d2_by_epoch.insert(epoch_index, l4d2.clone());
        }
        self.rows.push(DirectObservationRow {
            epoch_index,
            tick: value.tick,
            entity_index: value.entity_index,
            position: value.position,
            eye_angles: value.eye_angles,
            team: value.team,
            player_class,
            weapon,
            l4d2,
            repeats_l4d2,
            demo_time_seconds: value.demo_time_seconds,
            provenance,
        });
    }
}

impl Serialize for DirectCompactObservations {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut counters: Vec<_> = COUNTER_NAMES
            .iter()
            .enumerate()
            .filter_map(|(index, name)| self.counters_present[index].then_some(*name))
            .collect();
        counters.sort_unstable();
        let mut state = serializer.serialize_struct("DirectCompactObservations", 5)?;
        state.serialize_field("epochs", &self.epochs)?;
        state.serialize_field("strings", &self.strings)?;
        state.serialize_field("counters", &counters)?;
        state.serialize_field("propertyPaths", &self.property_paths)?;
        state.serialize_field(
            "rows",
            &Rows {
                owner: self,
                counters: &counters,
            },
        )?;
        state.end()
    }
}

struct Rows<'a> {
    owner: &'a DirectCompactObservations,
    counters: &'a [&'a str],
}
impl Serialize for Rows<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.owner.rows.len()))?;
        for row in &self.owner.rows {
            seq.serialize_element(&Row {
                row,
                counters: self.counters,
            })?;
        }
        seq.end()
    }
}
struct Row<'a> {
    row: &'a DirectObservationRow,
    counters: &'a [&'a str],
}
impl Serialize for Row<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let v = self.row;
        let mut row = serializer.serialize_seq(Some(OBSERVATION_ROW_FIELDS.len()))?;
        row.serialize_element(&v.epoch_index)?;
        row.serialize_element(&v.tick)?;
        row.serialize_element(&v.entity_index)?;
        row.serialize_element(&v.position)?;
        row.serialize_element(&v.eye_angles)?;
        row.serialize_element(&v.team)?;
        row.serialize_element(&v.player_class)?;
        row.serialize_element(&v.weapon)?;
        if v.repeats_l4d2 {
            row.serialize_element(&Option::<u8>::None)?;
        } else {
            row.serialize_element(&L4d2 {
                row: &v.l4d2,
                counters: self.counters,
            })?;
        }
        row.serialize_element(&(
            v.demo_time_seconds,
            v.provenance.position_form,
            &v.provenance.position_paths,
            v.provenance.eye_form,
            &v.provenance.eye_paths,
            v.provenance.team_path,
            v.provenance.class_path,
            v.provenance.weapon_tag,
            v.provenance.weapon_path,
        ))?;
        row.end()
    }
}
struct L4d2<'a> {
    row: &'a DirectL4d2Row,
    counters: &'a [&'a str],
}
impl Serialize for L4d2<'_> {
    #[allow(clippy::too_many_lines)]
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let v = &self.row.values;
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
        debug_assert_eq!(present.len(), L4D2_OPTIONAL_FIELDS.len());
        let mask = present
            .iter()
            .enumerate()
            .fold(0_u32, |m, (i, p)| if *p { m | 1 << i } else { m });
        let mut row = serializer.serialize_seq(None)?;
        row.serialize_element(&self.row.entity_index)?;
        row.serialize_element(&mask)?;
        macro_rules! optional {
            ($x:expr) => {
                if let Some(x) = $x {
                    row.serialize_element(x)?;
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
        if let Some(L4d2PlayerLoadout {
            primary_weapon_id,
            first_aid_slot_id,
            pills_slot_id,
        }) = &v.loadout
        {
            row.serialize_element(&(primary_weapon_id, first_aid_slot_id, pills_slot_id))?;
        }
        if let Some(L4d2ActiveWeaponAmmo {
            primary_ammo_type,
            clip,
            reserve,
            reloading,
            extra_primary_ammo,
            upgraded_ammo_loaded,
            ..
        }) = &v.active_weapon_ammo
        {
            row.serialize_element(&(
                self.row.ammo_class,
                primary_ammo_type,
                clip,
                reserve,
                reloading,
                extra_primary_ammo,
                upgraded_ammo_loaded,
            ))?;
        }
        let counters: Vec<_> = self
            .counters
            .iter()
            .map(|name| {
                let index = COUNTER_NAMES
                    .iter()
                    .position(|candidate| candidate == name)
                    .expect("serialized counter came from the fixed registry");
                self.row.counter_values[index]
            })
            .collect();
        row.serialize_element(&counters)?;
        row.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn direct_collector_interns_and_preserves_wire_shape() {
        let l4d2 = crate::projection::L4d2PlayerState {
            entity_index: 4,
            health: Some(0.0),
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
            counters: BTreeMap::from([("m_checkpointDeaths".into(), 3.0)]),
        };
        let mut direct = DirectCompactObservations::default();
        let first = CoreObservation {
            player_epoch_id: "epoch".into(),
            tick: 9,
            entity_index: 4,
            position: None,
            eye_angles: None,
            team: None,
            player_class: Some("Survivor".into()),
            weapon: Some("Survivor".into()),
            l4d2,
            demo_time_seconds: None,
            compact_provenance: crate::projection::CompactProvenance::default(),
            canonical: None,
        };
        direct.push(first.clone());
        let mut second = first;
        second.tick = 10;
        direct.push(second);
        assert_eq!(
            serde_json::to_value(direct).unwrap(),
            serde_json::json!({
                "epochs":["epoch"], "strings":["Survivor"], "counters":["m_checkpointDeaths"],
                "propertyPaths":[],
                "rows":[
                    [0,9,4,null,null,null,0,0,[4,1,0.0,[3.0]],[null,0,[],0,[],null,null,0,null]],
                    [0,10,4,null,null,null,0,0,null,[null,0,[],0,[],null,null,0,null]]
                ]
            })
        );
    }
}
