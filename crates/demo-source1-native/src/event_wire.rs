//! TypeScript-compatible JSON projection for decoded game-event telemetry.
//!
//! The decoder's internal event representation favours ordered vectors and
//! Rust enums. These wire types deliberately expose only the primitive,
//! camel-cased shapes consumed by the TypeScript native projection adapter.

use crate::artifact::{EventTelemetrySummary, RawEventVisit};
use crate::game_events::{
    Availability, DecodedGameEvent, EventSchema, EventValue, FieldType, RequiredEvent,
};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum EventPrimitiveWire {
    Boolean(bool),
    Number(f64),
    String(String),
}

impl From<&EventValue> for EventPrimitiveWire {
    fn from(value: &EventValue) -> Self {
        match value {
            EventValue::Boolean(value) => Self::Boolean(*value),
            EventValue::Number(value) => Self::Number(*value),
            EventValue::String(value) => Self::String(value.clone()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EventFieldTypeWire {
    String,
    Float,
    Long,
    Short,
    Byte,
    Boolean,
    Uint64,
}

impl From<FieldType> for EventFieldTypeWire {
    fn from(value: FieldType) -> Self {
        match value {
            FieldType::String => Self::String,
            FieldType::Float => Self::Float,
            FieldType::Long => Self::Long,
            FieldType::Short => Self::Short,
            FieldType::Byte => Self::Byte,
            FieldType::Boolean => Self::Boolean,
            FieldType::Uint64 => Self::Uint64,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EventFieldSchemaWire {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: EventFieldTypeWire,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EventSchemaWire {
    pub id: u32,
    pub name: String,
    pub fields: Vec<EventFieldSchemaWire>,
}

impl From<&EventSchema> for EventSchemaWire {
    fn from(schema: &EventSchema) -> Self {
        Self {
            id: schema.id,
            name: schema.name.clone(),
            fields: schema
                .fields
                .iter()
                .map(|field| EventFieldSchemaWire {
                    name: field.name.clone(),
                    field_type: field.field_type.into(),
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DecodedGameEventWire {
    pub id: u32,
    pub name: String,
    pub fields: BTreeMap<String, EventPrimitiveWire>,
    pub schema: EventSchemaWire,
}

impl From<&DecodedGameEvent> for DecodedGameEventWire {
    fn from(event: &DecodedGameEvent) -> Self {
        Self {
            id: event.id,
            name: event.name.clone(),
            fields: event
                .fields
                .iter()
                .map(|(name, value)| (name.clone(), value.into()))
                .collect(),
            schema: (&event.schema).into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventProvenanceWire {
    pub message: &'static str,
    pub event_id: u32,
    pub field: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum EventAvailabilityWire<T> {
    Observed {
        availability: &'static str,
        value: T,
        provenance: EventProvenanceWire,
    },
    Unavailable {
        availability: &'static str,
        reason: String,
    },
}

fn availability_wire<T: Clone>(value: &Availability<T>) -> EventAvailabilityWire<T> {
    match value {
        Availability::Observed {
            value,
            event_id,
            field,
        } => EventAvailabilityWire::Observed {
            availability: "observed",
            value: value.clone(),
            provenance: EventProvenanceWire {
                message: "svc_GameEvent",
                event_id: *event_id,
                field: field.clone(),
            },
        },
        Availability::Unavailable { reason } => EventAvailabilityWire::Unavailable {
            availability: "unavailable",
            reason: reason.clone(),
        },
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequiredEventWire {
    pub name: String,
    pub event_id: u32,
    pub tick: i32,
    pub actor_user_id: EventAvailabilityWire<f64>,
    pub victim_user_id: EventAvailabilityWire<f64>,
    pub attacker_user_id: EventAvailabilityWire<f64>,
    pub attacker_entity_id: EventAvailabilityWire<f64>,
    pub weapon: EventAvailabilityWire<String>,
    pub damage: EventAvailabilityWire<f64>,
    pub health: EventAvailabilityWire<f64>,
    pub damage_type: EventAvailabilityWire<f64>,
    pub decoded: DecodedGameEventWire,
}

impl From<(&RequiredEvent, &DecodedGameEvent)> for RequiredEventWire {
    fn from((event, decoded): (&RequiredEvent, &DecodedGameEvent)) -> Self {
        Self {
            name: event.name.clone(),
            event_id: event.event_id,
            tick: event.tick,
            actor_user_id: availability_wire(&event.actor_user_id),
            victim_user_id: availability_wire(&event.victim_user_id),
            attacker_user_id: availability_wire(&event.attacker_user_id),
            attacker_entity_id: availability_wire(&event.attacker_entity_id),
            weapon: availability_wire(&event.weapon),
            damage: availability_wire(&event.damage),
            health: availability_wire(&event.health),
            damage_type: availability_wire(&event.damage_type),
            decoded: decoded.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEventVisitWire {
    pub demo_tick: i32,
    pub engine_tick: Option<u32>,
    pub event: DecodedGameEventWire,
    pub required: Option<RequiredEventWire>,
}

impl From<&RawEventVisit> for RawEventVisitWire {
    fn from(visit: &RawEventVisit) -> Self {
        Self {
            demo_tick: visit.demo_tick,
            engine_tick: visit.engine_tick,
            event: (&visit.event).into(),
            required: visit
                .required
                .as_ref()
                .map(|required| (required, &visit.event).into()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventTelemetrySummaryWire {
    pub schema_lists: usize,
    pub schemas: usize,
    pub events: usize,
    pub required_events: BTreeMap<String, usize>,
}

impl From<&EventTelemetrySummary> for EventTelemetrySummaryWire {
    fn from(summary: &EventTelemetrySummary) -> Self {
        Self {
            schema_lists: summary.schema_lists,
            schemas: summary.schemas,
            events: summary.events,
            required_events: summary.required_events.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_events::{FieldSchema, project_required_event};
    use serde_json::json;

    fn decoded() -> DecodedGameEvent {
        DecodedGameEvent {
            id: 7,
            name: "player_hurt".into(),
            fields: vec![
                ("userid".into(), EventValue::Number(12.0)),
                ("critical".into(), EventValue::Boolean(false)),
                ("weapon".into(), EventValue::String("rifle".into())),
            ],
            schema: EventSchema {
                id: 7,
                name: "player_hurt".into(),
                fields: vec![
                    FieldSchema {
                        name: "userid".into(),
                        field_type: FieldType::Long,
                    },
                    FieldSchema {
                        name: "critical".into(),
                        field_type: FieldType::Boolean,
                    },
                    FieldSchema {
                        name: "weapon".into(),
                        field_type: FieldType::String,
                    },
                ],
            },
        }
    }

    #[test]
    fn decoded_event_uses_primitive_field_object_and_ts_schema_names() {
        assert_eq!(
            serde_json::to_value(DecodedGameEventWire::from(&decoded())).unwrap(),
            json!({
                "id": 7,
                "name": "player_hurt",
                "fields": { "critical": false, "userid": 12.0, "weapon": "rifle" },
                "schema": {
                    "id": 7,
                    "name": "player_hurt",
                    "fields": [
                        { "name": "userid", "type": "long" },
                        { "name": "critical", "type": "boolean" },
                        { "name": "weapon", "type": "string" }
                    ]
                }
            })
        );
    }

    #[test]
    fn raw_visit_and_required_availability_match_ts_casing_and_provenance() {
        let event = decoded();
        let required = project_required_event(&event, 99).unwrap();
        let visit = RawEventVisit {
            demo_tick: 99,
            engine_tick: Some(101),
            event,
            required: Some(required),
        };
        let value = serde_json::to_value(RawEventVisitWire::from(&visit)).unwrap();
        assert_eq!(value["demoTick"], 99);
        assert_eq!(value["engineTick"], 101);
        assert_eq!(value["required"]["eventId"], 7);
        assert_eq!(value["required"]["decoded"], value["event"]);
        assert_eq!(
            value["required"]["actorUserId"],
            json!({
                "availability": "observed",
                "value": 12.0,
                "provenance": { "message": "svc_GameEvent", "eventId": 7, "field": "userid" }
            })
        );
        assert_eq!(
            value["required"]["damage"],
            json!({ "availability": "unavailable", "reason": "schema does not expose numeric dmg_health" })
        );
    }

    #[test]
    fn summary_is_camel_cased() {
        let summary = EventTelemetrySummary {
            schema_lists: 1,
            schemas: 2,
            events: 3,
            required_events: BTreeMap::from([("player_hurt".into(), 1)]),
        };
        assert_eq!(
            serde_json::to_value(EventTelemetrySummaryWire::from(&summary)).unwrap(),
            json!({
                "schemaLists": 1,
                "schemas": 2,
                "events": 3,
                "requiredEvents": { "player_hurt": 1 }
            })
        );
    }
}
