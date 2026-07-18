use crate::bit_reader::BitReader;
#[allow(clippy::wildcard_imports)]
use crate::data_tables::*;
use crate::data_tables::{decode_l4d2_data_tables, flatten_server_classes};
use crate::demo::DemoCommandKind;
use crate::network::{Envelope, extract_network_bits};
use crate::string_tables::DemoStringTable;
use crate::string_tables::{StringTableLimits, decode_string_table_snapshot};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
const MAX_EDICTS: usize = 2048;
#[derive(Clone, Debug, PartialEq)]
pub enum PropValue {
    Number(f64),
    String(String),
    Array(Vec<PropValue>),
}
#[derive(Clone, Debug, PartialEq)]
pub struct DecodedProperty {
    pub index: usize,
    pub path: String,
    pub value: PropValue,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ClassBaseline {
    pub class_id: u32,
    pub properties: Vec<DecodedProperty>,
    pub consumed_bits: usize,
    pub source_bits: usize,
}
pub fn decode_class_baseline(
    bytes: &[u8],
    class: &FlattenedServerClass,
) -> Result<ClassBaseline, String> {
    let mut r = BitReader::new(bytes);
    let properties = decode_property_stream(&mut r, &class.props)?;
    Ok(ClassBaseline {
        class_id: class.schema.data_table_id,
        properties,
        consumed_bits: r.bit_offset(),
        source_bits: bytes.len() * 8,
    })
}
pub fn decode_instance_baselines(
    table: &DemoStringTable,
    classes: &[FlattenedServerClass],
) -> Result<HashMap<u32, ClassBaseline>, String> {
    if table.name != "instancebaseline" {
        return Err("expected instancebaseline string table".into());
    }
    let by_id: HashMap<_, _> = classes
        .iter()
        .map(|c| (c.schema.data_table_id, c))
        .collect();
    let mut out = HashMap::new();
    for entry in &table.entries {
        let Some(data) = entry.data.as_deref() else {
            continue;
        };
        if entry.name.is_empty()
            || (entry.name.len() > 1 && entry.name.starts_with('0'))
            || !entry.name.bytes().all(|v| v.is_ascii_digit())
        {
            return Err(format!("invalid baseline class ID {}", entry.name));
        }
        let id = entry
            .name
            .parse::<u32>()
            .map_err(|_| format!("invalid baseline class ID {}", entry.name))?;
        let class = by_id
            .get(&id)
            .ok_or_else(|| format!("unknown baseline class ID {id}"))?;
        out.insert(id, decode_class_baseline(data, class)?);
    }
    Ok(out)
}
pub fn decode_property_stream(
    r: &mut BitReader<'_>,
    props: &[FlattenedSendProp],
) -> Result<Vec<DecodedProperty>, String> {
    let new_way = r.read_bool().map_err(text)?;
    let (mut out, mut last) = (Vec::new(), None);
    while let Some(index) = read_property_index(r, last, new_way)? {
        if last.is_some_and(|v| index <= v) || index >= props.len() {
            return Err(format!(
                "property index {index} outside {} at bit {}",
                props.len(),
                r.bit_offset()
            ));
        }
        out.push(DecodedProperty {
            index,
            path: props[index].path.clone(),
            value: decode_value(r, &props[index])?,
        });
        last = Some(index);
    }
    Ok(out)
}
fn read_property_index(
    r: &mut BitReader<'_>,
    last: Option<usize>,
    new_way: bool,
) -> Result<Option<usize>, String> {
    let previous = last.map_or(-1_i64, |v| {
        i64::try_from(v).expect("bounded property index")
    });
    if new_way && r.read_bool().map_err(text)? {
        return Ok(Some(usize::try_from(previous + 1).expect("nonnegative")));
    }
    let delta = if new_way && r.read_bool().map_err(text)? {
        r.read_bits(3).map_err(text)?
    } else {
        let mut d = r.read_bits(7).map_err(text)?;
        d = match d & 0x60 {
            0x20 => (d & 0x1f) | (r.read_bits(2).map_err(text)? << 5),
            0x40 => (d & 0x1f) | (r.read_bits(4).map_err(text)? << 5),
            0x60 => (d & 0x1f) | (r.read_bits(7).map_err(text)? << 5),
            _ => d,
        };
        d
    };
    if delta == 4095 {
        return Ok(None);
    }
    Ok(Some(
        usize::try_from(previous + i64::from(delta) + 1).map_err(|_| "property index overflow")?,
    ))
}
#[allow(clippy::many_single_char_names)]
fn decode_value(r: &mut BitReader<'_>, flat: &FlattenedSendProp) -> Result<PropValue, String> {
    let p = &flat.prop;
    Ok(match p.prop_type {
        0 => PropValue::Number(if p.flags & FLAG_UNSIGNED != 0 {
            f64::from(r.read_bits(bits(p.bit_count)?).map_err(text)?)
        } else {
            f64::from(
                i32::try_from(r.read_signed_bits(bits(p.bit_count)?).map_err(text)?)
                    .expect("at most 32 signed bits"),
            )
        }),
        1 => PropValue::Number(decode_float(r, p)?),
        2 => {
            let x = decode_float(r, p)?;
            let y = decode_float(r, p)?;
            let z = if p.flags & FLAG_NORMAL != 0 {
                let sign = if r.read_bool().map_err(text)? {
                    -1.0
                } else {
                    1.0
                };
                sign * f64::max(0.0, 1.0 - x * x - y * y).sqrt()
            } else {
                decode_float(r, p)?
            };
            PropValue::Array(vec![
                PropValue::Number(x),
                PropValue::Number(y),
                PropValue::Number(z),
            ])
        }
        3 => PropValue::Array(vec![
            PropValue::Number(decode_float(r, p)?),
            PropValue::Number(decode_float(r, p)?),
        ]),
        4 => {
            let n = r.read_bits(9).map_err(text)? as usize;
            if n >= 512 {
                return Err("send-prop string limit exceeded".into());
            }
            PropValue::String(r.read_latin1(n).map_err(text)?)
        }
        5 => {
            let element = flat
                .array_element
                .as_ref()
                .ok_or("invalid array property")?;
            let max = p.array_elements.ok_or("invalid array property")?;
            if max < 1 {
                return Err("invalid array property".into());
            }
            let count = r
                .read_bits((32 - max.leading_zeros()) as usize)
                .map_err(text)?;
            if count > max {
                return Err(format!("array count {count} exceeds {max}"));
            }
            let nested = FlattenedSendProp {
                path: flat.path.clone(),
                prop: element.clone(),
                array_element: None,
            };
            PropValue::Array(
                (0..count)
                    .map(|_| decode_value(r, &nested))
                    .collect::<Result<_, _>>()?,
            )
        }
        _ => {
            return Err(format!(
                "unsupported flattened send-prop type {}",
                p.prop_type
            ));
        }
    })
}
fn decode_float(r: &mut BitReader<'_>, p: &SendPropSchema) -> Result<f64, String> {
    let flags = p.flags;
    let b = bits(p.bit_count)?;
    if flags & FLAG_COORD != 0 {
        return bit_coord(r);
    }
    if flags & FLAG_COORD_MP != 0 {
        return bit_coord_mp(r, false, false);
    }
    if flags & FLAG_COORD_MP_LOW != 0 {
        return bit_coord_mp(r, false, true);
    }
    if flags & FLAG_COORD_MP_INTEGRAL != 0 {
        return bit_coord_mp(r, true, false);
    }
    if flags & FLAG_CELL_COORD != 0 {
        return cell(r, b, false, false);
    }
    if flags & FLAG_CELL_COORD_LOW != 0 {
        return cell(r, b, false, true);
    }
    if flags & FLAG_CELL_COORD_INTEGRAL != 0 {
        return cell(r, b, true, false);
    }
    if flags & FLAG_NO_SCALE != 0 {
        return Ok(f64::from(r.read_f32().map_err(text)?));
    }
    if flags & FLAG_NORMAL != 0 {
        let sign = if r.read_bool().map_err(text)? {
            -1.0
        } else {
            1.0
        };
        return Ok(sign * f64::from(r.read_bits(11).map_err(text)?) / 2047.0);
    }
    let low = f64::from(p.low_value.ok_or("scaled float has no bounds")?);
    let high = f64::from(p.high_value.ok_or("scaled float has no bounds")?);
    if b == 0 {
        return Err("scaled float has zero bit count".into());
    }
    let raw = f64::from(r.read_bits(b).map_err(text)?);
    Ok(low + (high - low) * (raw / (2_f64.powi(i32::try_from(b).expect("<=32")) - 1.0)))
}
fn bit_coord(r: &mut BitReader<'_>) -> Result<f64, String> {
    let i = r.read_bool().map_err(text)?;
    let f = r.read_bool().map_err(text)?;
    if !i && !f {
        return Ok(0.0);
    }
    let sign = if r.read_bool().map_err(text)? {
        -1.0
    } else {
        1.0
    };
    let integer = if i {
        f64::from(r.read_bits(14).map_err(text)? + 1)
    } else {
        0.0
    };
    let fraction = if f {
        f64::from(r.read_bits(5).map_err(text)?) / 32.0
    } else {
        0.0
    };
    Ok(sign * (integer + fraction))
}
fn bit_coord_mp(r: &mut BitReader<'_>, integral: bool, low: bool) -> Result<f64, String> {
    let inside = r.read_bool().map_err(text)?;
    let integer = r.read_bool().map_err(text)?;
    if integral && !integer {
        return Ok(0.0);
    }
    let sign = if r.read_bool().map_err(text)? {
        -1.0
    } else {
        1.0
    };
    let i = if integer {
        f64::from(r.read_bits(if inside { 11 } else { 14 }).map_err(text)? + 1)
    } else {
        0.0
    };
    let f = if integral {
        0.0
    } else {
        let bits = if low { 3 } else { 5 };
        f64::from(r.read_bits(bits).map_err(text)?) / if low { 8.0 } else { 32.0 }
    };
    Ok(sign * (i + f))
}
fn cell(r: &mut BitReader<'_>, bits: usize, integral: bool, low: bool) -> Result<f64, String> {
    let i = f64::from(r.read_bits(bits).map_err(text)?);
    if integral {
        return Ok(i);
    }
    Ok(
        i + f64::from(r.read_bits(if low { 3 } else { 5 }).map_err(text)?)
            / if low { 8.0 } else { 32.0 },
    )
}
fn bits(value: Option<u32>) -> Result<usize, String> {
    let value = value.ok_or_else(|| "invalid send-prop bit count null".to_owned())?;
    if value > 32 {
        return Err(format!("invalid send-prop bit count {value}"));
    }
    Ok(value as usize)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpdateKind {
    Enter,
    Delta,
    Leave,
    Delete,
}
#[derive(Clone, Debug, PartialEq)]
pub struct EntityUpdate {
    pub entity_index: usize,
    pub kind: UpdateKind,
    pub class_id: Option<u32>,
    pub serial: Option<u32>,
    pub properties: Vec<DecodedProperty>,
}
#[allow(clippy::too_many_arguments, clippy::implicit_hasher)]
pub fn decode_packet_entity_data(
    bytes: &[u8],
    bit_length: usize,
    updated_entries: usize,
    classes: &[FlattenedServerClass],
    class_by_entity: &HashMap<usize, u32>,
    explicit_deletions: bool,
    is_delta: bool,
    max_entries: usize,
) -> Result<Vec<EntityUpdate>, String> {
    if updated_entries > MAX_EDICTS || bit_length > bytes.len() * 8 {
        return Err("invalid updated entity count or bit length".into());
    }
    let mut r = BitReader::span(bytes, 0, bit_length).map_err(text)?;
    let class_bits = if classes.len() <= 1 {
        0
    } else {
        (usize::BITS - (classes.len() - 1).leading_zeros()) as usize
    };
    let by_id: HashMap<_, _> = classes
        .iter()
        .map(|c| (c.schema.data_table_id, c))
        .collect();
    let (mut out, mut entity) = (Vec::new(), None);
    for _ in 0..updated_entries {
        let delta = usize::try_from(r.read_ubit_var().map_err(text)?).expect("u32 fits usize") + 1;
        let index = entity.map_or(delta - 1, |v: usize| v + delta);
        if index >= MAX_EDICTS {
            return Err(format!("entity index {index} exceeds limit"));
        }
        entity = Some(index);
        if r.read_bool().map_err(text)? {
            out.push(EntityUpdate {
                entity_index: index,
                kind: if r.read_bool().map_err(text)? {
                    UpdateKind::Delete
                } else {
                    UpdateKind::Leave
                },
                class_id: None,
                serial: None,
                properties: Vec::new(),
            });
            continue;
        }
        if r.read_bool().map_err(text)? {
            let id = r.read_bits(class_bits).map_err(text)?;
            let serial = r.read_bits(10).map_err(text)?;
            let class = by_id
                .get(&id)
                .ok_or_else(|| format!("unknown entity class {id}"))?;
            out.push(EntityUpdate {
                entity_index: index,
                kind: UpdateKind::Enter,
                class_id: Some(id),
                serial: Some(serial),
                properties: decode_property_stream(&mut r, &class.props)?,
            });
            continue;
        }
        let id = *class_by_entity
            .get(&index)
            .ok_or_else(|| format!("delta for unknown entity {index}"))?;
        let class = by_id
            .get(&id)
            .ok_or_else(|| format!("unknown entity class {id}"))?;
        out.push(EntityUpdate {
            entity_index: index,
            kind: UpdateKind::Delta,
            class_id: Some(id),
            serial: None,
            properties: decode_property_stream(&mut r, &class.props)?,
        });
    }
    if explicit_deletions {
        if !is_delta {
            return Err("L4D2 explicit deletions require a delta packet".into());
        }
        let count = usize::try_from(bounded_ubit(&mut r)?).expect("u32 fits usize");
        if count > max_entries {
            return Err("explicit entity deletion count exceeds limit".into());
        }
        let mut last = None;
        for _ in 0..count {
            let delta = usize::try_from(bounded_ubit(&mut r)?).expect("u32 fits usize");
            if delta == 0 {
                return Err("explicit entity deletion delta must be positive".into());
            }
            let index = last.map_or(delta - 1, |v: usize| v + delta);
            if index >= max_entries {
                return Err(format!("deleted entity index {index} exceeds limit"));
            }
            last = Some(index);
            out.push(EntityUpdate {
                entity_index: index,
                kind: UpdateKind::Delete,
                class_id: None,
                serial: None,
                properties: Vec::new(),
            });
        }
        if r.remaining_bits() != 0 {
            return Err("explicit deletion list has trailing bits".into());
        }
    }
    Ok(out)
}
fn bounded_ubit(r: &mut BitReader<'_>) -> Result<u32, String> {
    if r.remaining_bits() < 6 {
        return Err("truncated explicit entity deletion integer".into());
    }
    let head = r.read_bits(6).map_err(text)?;
    let tail = [0, 4, 8, 28][usize::try_from(head >> 4).expect("2-bit")];
    if r.remaining_bits() < tail {
        return Err("truncated explicit entity deletion integer".into());
    }
    Ok((head & 15) + r.read_bits(tail).map_err(text)? * 16)
}
#[derive(Clone, Debug, PartialEq)]
pub struct EntitySnapshot {
    pub entity_index: usize,
    pub class_id: u32,
    pub serial: u32,
    pub lifetime: u64,
    pub active: bool,
    pub properties: Arc<Vec<Option<PropValue>>>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct EntityFrame {
    pub sequence: u32,
    pub entities: HashMap<usize, EntitySnapshot>,
}
type DynamicBaseline = HashMap<usize, (u32, Arc<Vec<Option<PropValue>>>)>;
pub struct EntityReconstructor {
    max_entries: usize,
    max_history: usize,
    instance: HashMap<u32, ClassBaseline>,
    frames: HashMap<u32, EntityFrame>,
    order: VecDeque<u32>,
    dynamic: [DynamicBaseline; 2],
    next_lifetime: u64,
}
impl EntityReconstructor {
    pub fn new(
        max_entries: usize,
        max_history: usize,
        instance: HashMap<u32, ClassBaseline>,
    ) -> Result<Self, String> {
        if max_entries == 0 || max_entries > MAX_EDICTS || max_history == 0 {
            return Err("invalid entity-state bounds".into());
        }
        Ok(Self {
            max_entries,
            max_history,
            instance,
            frames: HashMap::new(),
            order: VecDeque::new(),
            dynamic: [HashMap::new(), HashMap::new()],
            next_lifetime: 1,
        })
    }
    #[must_use]
    pub fn frame(&self, sequence: u32) -> Option<&EntityFrame> {
        self.frames.get(&sequence)
    }
    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_lines)]
    pub fn apply(
        &mut self,
        sequence: u32,
        is_delta: bool,
        delta_from: Option<u32>,
        baseline: usize,
        update_baseline: bool,
        max_entries: usize,
        updates: &[EntityUpdate],
        classes: &[FlattenedServerClass],
    ) -> Result<EntityFrame, String> {
        if self.frames.contains_key(&sequence)
            || max_entries == 0
            || max_entries > self.max_entries
            || baseline > 1
        {
            return Err("invalid or duplicate entity packet".into());
        }
        let mut entities = if is_delta {
            let source_sequence = delta_from.ok_or("delta packet has no source sequence")?;
            self.frames
                .get(&source_sequence)
                .ok_or_else(|| format!("missing delta frame {source_sequence}"))?
                .entities
                .clone()
        } else {
            HashMap::new()
        };
        let mut touched = HashSet::new();
        for update in updates {
            if update.entity_index >= max_entries
                || !touched.insert(update.entity_index) && update.kind != UpdateKind::Delete
            {
                return Err(format!(
                    "duplicate or out-of-range entity {}",
                    update.entity_index
                ));
            }
            let class_id = update.class_id.or_else(|| {
                entities
                    .get(&update.entity_index)
                    .map(|entity| entity.class_id)
            });
            let property_limit = class_id
                .and_then(|id| usize::try_from(id).ok())
                .and_then(|id| classes.get(id))
                .map(|class| class.props.len());
            if !update.properties.is_empty()
                && property_limit.is_none_or(|limit| {
                    update
                        .properties
                        .iter()
                        .any(|property| property.index >= limit)
                })
            {
                return Err(format!(
                    "entity {} property index exceeds class schema",
                    update.entity_index
                ));
            }
            match update.kind {
                UpdateKind::Delete => {
                    entities.remove(&update.entity_index);
                }
                UpdateKind::Leave => {
                    let current = entities.get_mut(&update.entity_index).ok_or_else(|| {
                        format!("leave for unknown entity {}", update.entity_index)
                    })?;
                    current.active = false;
                }
                UpdateKind::Delta => {
                    let current = entities.get_mut(&update.entity_index).ok_or_else(|| {
                        format!("delta for inactive entity {}", update.entity_index)
                    })?;
                    if !current.active {
                        return Err(format!("delta for inactive entity {}", update.entity_index));
                    }
                    current.properties = merge_properties(&current.properties, &update.properties);
                }
                UpdateKind::Enter => {
                    let class = update.class_id.ok_or("enter lacks class")?;
                    let serial = update.serial.ok_or("enter lacks serial")?;
                    let resumed = entities
                        .get(&update.entity_index)
                        .is_some_and(|v| v.class_id == class && v.serial == serial);
                    let mut properties = if is_delta {
                        self.dynamic[baseline]
                            .get(&update.entity_index)
                            .filter(|(id, _)| *id == class)
                            .map_or_else(
                                || baseline_map(self.instance.get(&class)),
                                |(_, p)| p.clone(),
                            )
                    } else {
                        baseline_map(self.instance.get(&class))
                    };
                    properties = merge_properties(&properties, &update.properties);
                    let lifetime = if resumed {
                        entities
                            .get(&update.entity_index)
                            .map(|entity| entity.lifetime)
                            .ok_or_else(|| {
                                format!(
                                    "resumed entity {} disappeared during update",
                                    update.entity_index
                                )
                            })?
                    } else {
                        let v = self.next_lifetime;
                        self.next_lifetime += 1;
                        v
                    };
                    let entered = EntitySnapshot {
                        entity_index: update.entity_index,
                        class_id: class,
                        serial,
                        lifetime,
                        active: true,
                        properties,
                    };
                    if update_baseline {
                        self.dynamic[1 - baseline]
                            .insert(update.entity_index, (class, entered.properties.clone()));
                    }
                    entities.insert(update.entity_index, entered);
                }
            }
        }
        let frame = EntityFrame { sequence, entities };
        self.frames.insert(sequence, frame.clone());
        self.order.push_back(sequence);
        while self.order.len() > self.max_history {
            if let Some(old) = self.order.pop_front() {
                self.frames.remove(&old);
            }
        }
        Ok(frame)
    }
}
fn baseline_map(value: Option<&ClassBaseline>) -> Arc<Vec<Option<PropValue>>> {
    let mut out = Vec::new();
    if let Some(v) = value {
        merge_values(&mut out, &v.properties);
    }
    Arc::new(out)
}
fn merge_properties(
    base: &Arc<Vec<Option<PropValue>>>,
    values: &[DecodedProperty],
) -> Arc<Vec<Option<PropValue>>> {
    let mut out = base.as_ref().clone();
    merge_values(&mut out, values);
    Arc::new(out)
}
fn merge_values(out: &mut Vec<Option<PropValue>>, values: &[DecodedProperty]) {
    for value in values {
        if out.len() <= value.index {
            out.resize(value.index + 1, None);
        }
        out[value.index] = Some(value.value.clone());
    }
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntityFrameSummary {
    pub demo_tick: i32,
    pub engine_tick: u32,
    pub entities: usize,
    pub terror_players: usize,
}
pub fn reconstruct_entity_summaries(bytes: &[u8]) -> Result<Vec<EntityFrameSummary>, String> {
    let mut output = Vec::new();
    visit_entity_frames(bytes, |demo_tick, engine_tick, frame, classes| {
        let terror = frame
            .entities
            .values()
            .filter(|e| {
                e.active
                    && usize::try_from(e.class_id)
                        .ok()
                        .and_then(|class_id| classes.get(class_id))
                        .is_some_and(|c| c.schema.class_name == "CTerrorPlayer")
            })
            .count();
        output.push(EntityFrameSummary {
            demo_tick,
            engine_tick,
            entities: frame.entities.len(),
            terror_players: terror,
        });
    })?;
    Ok(output)
}
#[allow(clippy::too_many_lines, clippy::similar_names)]
pub fn visit_entity_frames<F: FnMut(i32, u32, &EntityFrame, &[FlattenedServerClass])>(
    bytes: &[u8],
    mut visit: F,
) -> Result<(), String> {
    let prepared = crate::traversal::PreparedDemo::new(bytes).map_err(|error| error.to_string())?;
    visit_entity_frames_prepared(&prepared, &mut visit)
}

#[allow(clippy::too_many_lines, clippy::similar_names)]
pub(crate) fn visit_entity_frames_prepared<
    F: FnMut(i32, u32, &EntityFrame, &[FlattenedServerClass]),
>(
    prepared: &crate::traversal::PreparedDemo<'_>,
    mut visit: F,
) -> Result<(), String> {
    let demo = &prepared.demo;
    if demo.header.demo_protocol != 4 || demo.header.network_protocol != 2100 {
        return Err("entity reconstruction requires L4D2 protocol 2100".into());
    }
    let data = demo
        .frames
        .iter()
        .find(|f| f.kind == DemoCommandKind::DataTables)
        .and_then(|f| f.payload)
        .ok_or("demo has no data-table snapshot")?;
    let classes = flatten_server_classes(&decode_l4d2_data_tables(data)?)?;
    let strings = demo
        .frames
        .iter()
        .find(|f| f.kind == DemoCommandKind::StringTables)
        .and_then(|f| f.payload)
        .ok_or("demo has no string-table snapshot")?;
    let snapshot = decode_string_table_snapshot(strings, StringTableLimits::default())?;
    let baseline = snapshot
        .tables
        .iter()
        .find(|t| t.name == "instancebaseline")
        .ok_or("demo has no instancebaseline table")?;
    let instance = decode_instance_baselines(baseline, &classes)?;
    let mut state = EntityReconstructor::new(MAX_EDICTS, 4, instance)?;
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
        let ticks: Vec<_> = inspection
            .messages
            .iter()
            .filter_map(|m| match m.envelope {
                Some(Envelope::Tick { engine_tick }) => Some(engine_tick),
                _ => None,
            })
            .collect();
        let packets: Vec<_> = inspection
            .messages
            .iter()
            .filter_map(|m| match &m.envelope {
                Some(Envelope::PacketEntities {
                    max_entries,
                    is_delta,
                    delta_from,
                    baseline,
                    updated_entries,
                    data_bit_length,
                    update_baseline,
                    data_start_bit,
                }) => Some((
                    *max_entries,
                    *is_delta,
                    *delta_from,
                    *baseline,
                    *updated_entries,
                    *data_bit_length,
                    *update_baseline,
                    *data_start_bit,
                )),
                _ => None,
            })
            .collect();
        if packets.is_empty() {
            continue;
        }
        if ticks.len() != 1 || packets.len() != 1 {
            return Err("ambiguous tick or PacketEntities message count".into());
        }
        let (max_entries, is_delta, delta_from, slot, updated, bits, update_baseline, start) =
            packets[0];
        let source = if is_delta {
            delta_from.and_then(|v| state.frame(v))
        } else {
            None
        };
        let class_by: HashMap<_, _> = source.map_or_else(HashMap::new, |f| {
            f.entities.iter().map(|(i, e)| (*i, e.class_id)).collect()
        });
        let nested = extract_network_bits(payload, start, usize::try_from(bits).expect("20-bit"))?;
        let updates = decode_packet_entity_data(
            &nested,
            usize::try_from(bits).expect("20-bit"),
            usize::try_from(updated).expect("11-bit"),
            &classes,
            &class_by,
            is_delta,
            is_delta,
            usize::try_from(max_entries).expect("11-bit"),
        )?;
        let engine = ticks[0];
        let result = state.apply(
            engine,
            is_delta,
            delta_from,
            usize::try_from(slot).expect("one-bit"),
            update_baseline,
            usize::try_from(max_entries).expect("11-bit"),
            &updates,
            &classes,
        )?;
        visit(
            frame
                .tick
                .unwrap_or(i32::try_from(engine).unwrap_or(i32::MAX)),
            engine,
            &result,
            &classes,
        );
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
    fn rejects_zero_explicit_deletion_delta_without_panicking() {
        // count=1 followed by delta=0, both short-form bounded UBit integers.
        let error = decode_packet_entity_data(&[1, 0], 12, 0, &[], &HashMap::new(), true, true, 32)
            .unwrap_err();
        assert!(error.contains("must be positive"));
    }
}
