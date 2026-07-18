use crate::bit_reader::BitReader;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum FieldType {
    String,
    Float,
    Long,
    Short,
    Byte,
    Boolean,
    Uint64,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FieldSchema {
    pub name: String,
    pub field_type: FieldType,
}
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EventSchema {
    pub id: u32,
    pub name: String,
    pub fields: Vec<FieldSchema>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum EventValue {
    Boolean(bool),
    Number(f64),
    String(String),
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DecodedGameEvent {
    pub id: u32,
    pub name: String,
    pub fields: Vec<(String, EventValue)>,
    pub schema: EventSchema,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub enum Availability<T> {
    Observed {
        value: T,
        event_id: u32,
        field: String,
    },
    Unavailable {
        reason: String,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RequiredEvent {
    pub name: String,
    pub event_id: u32,
    pub tick: i32,
    pub actor_user_id: Availability<f64>,
    pub victim_user_id: Availability<f64>,
    pub attacker_user_id: Availability<f64>,
    pub weapon: Availability<String>,
    pub damage: Availability<f64>,
    pub health: Availability<f64>,
}
#[must_use]
pub fn project_required_event(event: &DecodedGameEvent, tick: i32) -> Option<RequiredEvent> {
    if !matches!(
        event.name.as_str(),
        "weapon_fire" | "player_hurt" | "player_death"
    ) {
        return None;
    }
    let numeric = |field: &str| match event
        .fields
        .iter()
        .find(|(name, _)| name == field)
        .map(|(_, v)| v)
    {
        Some(EventValue::Number(value)) => Availability::Observed {
            value: *value,
            event_id: event.id,
            field: field.into(),
        },
        _ => Availability::Unavailable {
            reason: format!("schema does not expose numeric {field}"),
        },
    };
    let string = |field: &str| match event
        .fields
        .iter()
        .find(|(name, _)| name == field)
        .map(|(_, v)| v)
    {
        Some(EventValue::String(value)) => Availability::Observed {
            value: value.clone(),
            event_id: event.id,
            field: field.into(),
        },
        _ => Availability::Unavailable {
            reason: format!("schema does not expose string {field}"),
        },
    };
    let unavailable = |reason: &str| Availability::Unavailable {
        reason: reason.into(),
    };
    Some(RequiredEvent {
        name: event.name.clone(),
        event_id: event.id,
        tick,
        actor_user_id: numeric("userid"),
        victim_user_id: if event.name == "weapon_fire" {
            unavailable("event has no victim role")
        } else {
            numeric("userid")
        },
        attacker_user_id: if event.name == "weapon_fire" {
            unavailable("event has no attacker role")
        } else {
            numeric("attacker")
        },
        weapon: string("weapon"),
        damage: if event.name == "player_hurt" {
            numeric("dmg_health")
        } else {
            unavailable("event has no damage field")
        },
        health: if event.name == "player_hurt" {
            numeric("health")
        } else {
            unavailable("event has no health field")
        },
    })
}
#[derive(Clone, Copy, Debug)]
pub struct EventLimits {
    pub max_events: usize,
    pub max_fields_per_event: usize,
    pub max_string_bytes: usize,
    pub max_message_bits: usize,
    pub max_total_schema_bytes: usize,
}
impl Default for EventLimits {
    fn default() -> Self {
        Self {
            max_events: 512,
            max_fields_per_event: 128,
            max_string_bytes: 4096,
            max_message_bits: 8 * 1024 * 1024,
            max_total_schema_bytes: 4 * 1024 * 1024,
        }
    }
}

pub fn decode_event_list(
    bytes: &[u8],
    bit_length: usize,
    event_count: usize,
    l: EventLimits,
) -> Result<Vec<EventSchema>, String> {
    validate(bytes, bit_length)?;
    if bit_length > l.max_message_bits {
        return Err("game event list bit limit exceeded".into());
    }
    if event_count > l.max_events {
        return Err(format!("game event count {event_count} is invalid"));
    }
    let mut r = BitReader::span(bytes, 0, bit_length).map_err(text)?;
    let mut ids = HashSet::new();
    let mut output = Vec::with_capacity(event_count);
    let mut schema_bytes = 0_usize;
    for _ in 0..event_count {
        let id = r.read_bits(9).map_err(text)?;
        if !ids.insert(id) {
            return Err(format!("duplicate game event id {id}"));
        }
        let name = r.read_latin1_z(l.max_string_bytes).map_err(text)?;
        if name.is_empty() {
            return Err(format!("game event {id} has an empty name"));
        }
        schema_bytes = schema_bytes.saturating_add(name.len());
        let mut fields = Vec::new();
        loop {
            let kind = r.read_bits(3).map_err(text)?;
            if kind == 0 {
                break;
            }
            if fields.len() >= l.max_fields_per_event {
                return Err(format!("game event {id} field limit exceeded"));
            }
            let field_type = field_type(kind)?;
            let field_name = r.read_latin1_z(l.max_string_bytes).map_err(text)?;
            schema_bytes = schema_bytes.saturating_add(field_name.len());
            if schema_bytes > l.max_total_schema_bytes {
                return Err("game event schema byte limit exceeded".into());
            }
            if field_name.is_empty() {
                return Err(format!("game event {id} has an empty field name"));
            }
            if fields.iter().any(|f: &FieldSchema| f.name == field_name) {
                return Err(format!("game event {id} repeats field {field_name}"));
            }
            fields.push(FieldSchema {
                name: field_name,
                field_type,
            });
        }
        output.push(EventSchema { id, name, fields });
    }
    if r.bit_offset() != bit_length {
        return Err(format!(
            "game event list consumed {} of {bit_length} bits",
            r.bit_offset()
        ));
    }
    Ok(output)
}
pub fn decode_event(
    bytes: &[u8],
    bit_length: usize,
    schemas: &BTreeMap<u32, EventSchema>,
    l: EventLimits,
) -> Result<DecodedGameEvent, String> {
    validate(bytes, bit_length)?;
    if bit_length > l.max_message_bits {
        return Err("game event bit limit exceeded".into());
    }
    let mut r = BitReader::span(bytes, 0, bit_length).map_err(text)?;
    let id = r.read_bits(9).map_err(text)?;
    let schema = schemas
        .get(&id)
        .ok_or_else(|| format!("game event {id} has no registered schema"))?
        .clone();
    let mut fields = Vec::with_capacity(schema.fields.len());
    for field in &schema.fields {
        fields.push((
            field.name.clone(),
            read_value(&mut r, field.field_type, l.max_string_bytes)?,
        ));
    }
    if r.bit_offset() != bit_length {
        return Err(format!(
            "game event {id} consumed {} of {bit_length} bits",
            r.bit_offset()
        ));
    }
    Ok(DecodedGameEvent {
        id,
        name: schema.name.clone(),
        fields,
        schema,
    })
}
#[derive(Debug, Default)]
pub struct GameEventDecoder {
    schemas: BTreeMap<u32, EventSchema>,
    limits: EventLimits,
}
impl GameEventDecoder {
    pub fn register(&mut self, bytes: &[u8], bits: usize, count: usize) -> Result<(), String> {
        self.schemas = decode_event_list(bytes, bits, count, self.limits)?
            .into_iter()
            .map(|s| (s.id, s))
            .collect();
        Ok(())
    }
    pub fn decode(&self, bytes: &[u8], bits: usize) -> Result<DecodedGameEvent, String> {
        decode_event(bytes, bits, &self.schemas, self.limits)
    }
    #[must_use]
    pub fn schemas(&self) -> &BTreeMap<u32, EventSchema> {
        &self.schemas
    }
}
fn read_value(r: &mut BitReader<'_>, kind: FieldType, max: usize) -> Result<EventValue, String> {
    Ok(match kind {
        FieldType::String => EventValue::String(r.read_latin1_z(max).map_err(text)?),
        FieldType::Float => EventValue::Number(f64::from(r.read_f32().map_err(text)?)),
        FieldType::Long => EventValue::Number(f64::from(
            i32::try_from(r.read_signed_bits(32).map_err(text)?).expect("32-bit signed value"),
        )),
        FieldType::Short => EventValue::Number(f64::from(
            i16::try_from(r.read_signed_bits(16).map_err(text)?).expect("16-bit signed value"),
        )),
        FieldType::Byte => EventValue::Number(f64::from(r.read_bits(8).map_err(text)?)),
        FieldType::Boolean => EventValue::Boolean(r.read_bool().map_err(text)?),
        FieldType::Uint64 => {
            let low = u64::from(r.read_bits(32).map_err(text)?);
            let high = u64::from(r.read_bits(32).map_err(text)?);
            EventValue::String(((high << 32) | low).to_string())
        }
    })
}
fn field_type(id: u32) -> Result<FieldType, String> {
    Ok(match id {
        1 => FieldType::String,
        2 => FieldType::Float,
        3 => FieldType::Long,
        4 => FieldType::Short,
        5 => FieldType::Byte,
        6 => FieldType::Boolean,
        7 => FieldType::Uint64,
        _ => return Err(format!("unsupported game event field type {id}")),
    })
}
fn validate(bytes: &[u8], bits: usize) -> Result<(), String> {
    if bits > bytes.len() * 8 {
        return Err(format!("game event bit length {bits} is invalid"));
    }
    Ok(())
}
#[allow(clippy::needless_pass_by_value)]
fn text(e: impl ToString) -> String {
    e.to_string()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_schema() {
        let e = decode_event(&[0, 0], 9, &BTreeMap::new(), EventLimits::default()).unwrap_err();
        assert!(e.contains("no registered schema"));
    }
    #[test]
    fn empty_list_is_exact() {
        assert!(
            decode_event_list(&[], 0, 0, EventLimits::default())
                .unwrap()
                .is_empty()
        );
    }
}
