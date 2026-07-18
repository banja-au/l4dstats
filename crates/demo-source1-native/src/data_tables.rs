use crate::bit_reader::BitReader;
use std::collections::{HashMap, HashSet};

pub const FLAG_EXCLUDE: u32 = 1 << 6;
pub const FLAG_INSIDE_ARRAY: u32 = 1 << 8;
pub const FLAG_COLLAPSIBLE: u32 = 1 << 11;
pub const FLAG_CHANGES_OFTEN: u32 = 1 << 18;
pub const FLAG_UNSIGNED: u32 = 1;
const MAX_TOTAL_SEND_PROPS: usize = 262_144;
const MAX_FLATTENED_PROPS: usize = 16_384;
const MAX_SEND_TABLE_DEPTH: usize = 64;
const MAX_PROPERTY_PATH_BYTES: usize = 4_096;
pub const FLAG_COORD: u32 = 1 << 1;
pub const FLAG_NO_SCALE: u32 = 1 << 2;
pub const FLAG_NORMAL: u32 = 1 << 5;
pub const FLAG_COORD_MP: u32 = 1 << 12;
pub const FLAG_COORD_MP_LOW: u32 = 1 << 13;
pub const FLAG_COORD_MP_INTEGRAL: u32 = 1 << 14;
pub const FLAG_CELL_COORD: u32 = 1 << 15;
pub const FLAG_CELL_COORD_LOW: u32 = 1 << 16;
pub const FLAG_CELL_COORD_INTEGRAL: u32 = 1 << 17;
#[derive(Clone, Debug, PartialEq)]
pub struct SendPropSchema {
    pub prop_type: u32,
    pub name: String,
    pub flags: u32,
    pub priority: u32,
    pub data_table_name: Option<String>,
    pub low_value: Option<f32>,
    pub high_value: Option<f32>,
    pub bit_count: Option<u32>,
    pub array_elements: Option<u32>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct SendTableSchema {
    pub name: String,
    pub needs_decoder: bool,
    pub props: Vec<SendPropSchema>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerClassSchema {
    pub data_table_id: u32,
    pub class_name: String,
    pub data_table_name: String,
}
#[derive(Clone, Debug, PartialEq)]
pub struct DataTableSchema {
    pub tables: Vec<SendTableSchema>,
    pub server_classes: Vec<ServerClassSchema>,
    pub consumed_bits: usize,
}
#[derive(Clone, Debug, PartialEq)]
pub struct FlattenedSendProp {
    pub path: String,
    pub prop: SendPropSchema,
    pub array_element: Option<SendPropSchema>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct FlattenedServerClass {
    pub schema: ServerClassSchema,
    pub props: Vec<FlattenedSendProp>,
}

pub fn decode_l4d2_data_tables(payload: &[u8]) -> Result<DataTableSchema, String> {
    let mut r = BitReader::new(payload);
    let mut tables = Vec::new();
    let mut total_props = 0_usize;
    while r.read_bool().map_err(text)? {
        if tables.len() >= 4096 {
            return Err("send-table limit exceeded".into());
        }
        let needs_decoder = r.read_bool().map_err(text)?;
        let name = r.read_latin1_z(16384).map_err(text)?;
        let count = r.read_bits(10).map_err(text)?;
        total_props = total_props
            .checked_add(count as usize)
            .ok_or("send-property count overflow")?;
        if total_props > MAX_TOTAL_SEND_PROPS {
            return Err("global send-property limit exceeded".into());
        }
        let mut props = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let prop_type = r.read_bits(5).map_err(text)?;
            if prop_type > 6 {
                return Err(format!("unsupported send-prop type {prop_type}"));
            }
            let prop_name = r.read_latin1_z(16384).map_err(text)?;
            let flags = r.read_bits(19).map_err(text)?;
            let priority = r.read_bits(8).map_err(text)?;
            let (
                mut data_table_name,
                mut low_value,
                mut high_value,
                mut bit_count,
                mut array_elements,
            ) = (None, None, None, None, None);
            if prop_type == 6 || (flags & FLAG_EXCLUDE) != 0 {
                data_table_name = Some(r.read_latin1_z(16384).map_err(text)?);
            } else if prop_type == 5 {
                array_elements = Some(r.read_bits(10).map_err(text)?);
            } else {
                low_value = Some(r.read_f32().map_err(text)?);
                high_value = Some(r.read_f32().map_err(text)?);
                bit_count = Some(r.read_bits(6).map_err(text)?);
            }
            props.push(SendPropSchema {
                prop_type,
                name: prop_name,
                flags,
                priority,
                data_table_name,
                low_value,
                high_value,
                bit_count,
                array_elements,
            });
        }
        tables.push(SendTableSchema {
            name,
            needs_decoder,
            props,
        });
    }
    let count = r.read_bits(16).map_err(text)?;
    if count > 4096 {
        return Err("server-class limit exceeded".into());
    }
    let mut server_classes = Vec::with_capacity(count as usize);
    for _ in 0..count {
        server_classes.push(ServerClassSchema {
            data_table_id: r.read_bits(16).map_err(text)?,
            class_name: r.read_latin1_z(16384).map_err(text)?,
            data_table_name: r.read_latin1_z(16384).map_err(text)?,
        });
    }
    Ok(DataTableSchema {
        tables,
        server_classes,
        consumed_bits: r.bit_offset(),
    })
}

pub fn flatten_server_classes(
    schema: &DataTableSchema,
) -> Result<Vec<FlattenedServerClass>, String> {
    let mut by_name = HashMap::new();
    for table in &schema.tables {
        if by_name.insert(table.name.as_str(), table).is_some() {
            return Err(format!("duplicate send table {}", table.name));
        }
    }
    schema
        .server_classes
        .iter()
        .map(|class| {
            let root = *by_name
                .get(class.data_table_name.as_str())
                .ok_or_else(|| format!("missing send table {}", class.data_table_name))?;
            let mut excludes = HashSet::new();
            collect_excludes(root, &by_name, &mut excludes, &mut HashSet::new(), 0)?;
            let mut gathered = Vec::new();
            gather_props(
                root,
                "",
                &by_name,
                &excludes,
                &mut gathered,
                &mut HashSet::new(),
            )?;
            Ok(FlattenedServerClass {
                schema: class.clone(),
                props: sort_by_priority(gathered),
            })
        })
        .collect()
}
fn collect_excludes<'a>(
    table: &'a SendTableSchema,
    tables: &HashMap<&'a str, &'a SendTableSchema>,
    out: &mut HashSet<(String, String)>,
    visited: &mut HashSet<String>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_SEND_TABLE_DEPTH {
        return Err("send-table nesting limit exceeded".into());
    }
    if !visited.insert(table.name.clone()) {
        return Ok(());
    }
    for prop in &table.props {
        if prop.flags & FLAG_EXCLUDE != 0
            && let Some(name) = &prop.data_table_name
        {
            out.insert((name.clone(), prop.name.clone()));
        }
        if prop.prop_type == 6
            && let Some(child) = prop.data_table_name.as_deref().and_then(|n| tables.get(n))
        {
            collect_excludes(child, tables, out, visited, depth + 1)?;
        }
    }
    Ok(())
}
fn gather_props<'a>(
    table: &'a SendTableSchema,
    prefix: &str,
    tables: &HashMap<&'a str, &'a SendTableSchema>,
    excludes: &HashSet<(String, String)>,
    out: &mut Vec<FlattenedSendProp>,
    stack: &mut HashSet<String>,
) -> Result<(), String> {
    if stack.len() >= MAX_SEND_TABLE_DEPTH {
        return Err("send-table nesting limit exceeded".into());
    }
    if !stack.insert(table.name.clone()) {
        return Err(format!("cyclic send table {}", table.name));
    }
    let mut local = Vec::new();
    iterate_props(table, prefix, tables, excludes, out, &mut local, stack)?;
    out.extend(local);
    stack.remove(&table.name);
    Ok(())
}
fn iterate_props<'a>(
    table: &'a SendTableSchema,
    prefix: &str,
    tables: &HashMap<&'a str, &'a SendTableSchema>,
    excludes: &HashSet<(String, String)>,
    out: &mut Vec<FlattenedSendProp>,
    local: &mut Vec<FlattenedSendProp>,
    stack: &mut HashSet<String>,
) -> Result<(), String> {
    for (index, prop) in table.props.iter().enumerate() {
        if prop.flags & (FLAG_EXCLUDE | FLAG_INSIDE_ARRAY) != 0
            || excludes.contains(&(table.name.clone(), prop.name.clone()))
        {
            continue;
        }
        let path = if prefix.is_empty() {
            prop.name.clone()
        } else {
            format!("{prefix}.{}", prop.name)
        };
        if path.len() > MAX_PROPERTY_PATH_BYTES {
            return Err("flattened property path limit exceeded".into());
        }
        if prop.prop_type == 6 {
            let name = prop
                .data_table_name
                .as_deref()
                .ok_or_else(|| format!("datatable {path} has no target"))?;
            let child = *tables
                .get(name)
                .ok_or_else(|| format!("missing send table {name}"))?;
            if prop.flags & FLAG_COLLAPSIBLE != 0 {
                if !stack.insert(child.name.clone()) {
                    return Err(format!("cyclic send table {}", child.name));
                }
                iterate_props(child, prefix, tables, excludes, out, local, stack)?;
                stack.remove(&child.name);
            } else {
                gather_props(child, &prop.name, tables, excludes, out, stack)?;
            }
            continue;
        }
        let array_element = if prop.prop_type == 5 && index > 0 {
            Some(table.props[index - 1].clone())
        } else {
            None
        };
        if prop.prop_type == 5
            && array_element
                .as_ref()
                .is_some_and(|v| v.flags & FLAG_INSIDE_ARRAY == 0)
        {
            return Err(format!("array {path} has no inside-array element"));
        }
        local.push(FlattenedSendProp {
            path,
            prop: prop.clone(),
            array_element,
        });
        if out.len() + local.len() > MAX_FLATTENED_PROPS {
            return Err("flattened property count limit exceeded".into());
        }
    }
    Ok(())
}
fn sort_by_priority(mut props: Vec<FlattenedSendProp>) -> Vec<FlattenedSendProp> {
    let mut priorities: Vec<u32> = props.iter().map(|p| p.prop.priority).chain([64]).collect();
    priorities.sort_unstable();
    priorities.dedup();
    let mut start = 0;
    for priority in priorities {
        loop {
            let found = (start..props.len()).find(|&i| {
                props[i].prop.priority == priority
                    || (priority == 64 && props[i].prop.flags & FLAG_CHANGES_OFTEN != 0)
            });
            let Some(index) = found else { break };
            props.swap(start, index);
            start += 1;
        }
    }
    props
}
#[allow(clippy::needless_pass_by_value)]
fn text(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn prop(name: &str, priority: u32) -> SendPropSchema {
        SendPropSchema {
            prop_type: 0,
            name: name.into(),
            flags: 0,
            priority,
            data_table_name: None,
            low_value: Some(0.0),
            high_value: Some(1.0),
            bit_count: Some(1),
            array_elements: None,
        }
    }
    #[test]
    fn nested_noncollapsible_precedes_local_and_priority_applies() {
        let schema = DataTableSchema {
            tables: vec![
                SendTableSchema {
                    name: "root".into(),
                    needs_decoder: false,
                    props: vec![
                        SendPropSchema {
                            prop_type: 6,
                            name: "base".into(),
                            flags: 0,
                            priority: 0,
                            data_table_name: Some("child".into()),
                            low_value: None,
                            high_value: None,
                            bit_count: None,
                            array_elements: None,
                        },
                        prop("local", 10),
                    ],
                },
                SendTableSchema {
                    name: "child".into(),
                    needs_decoder: false,
                    props: vec![prop("nested", 5)],
                },
            ],
            server_classes: vec![ServerClassSchema {
                data_table_id: 0,
                class_name: "C".into(),
                data_table_name: "root".into(),
            }],
            consumed_bits: 0,
        };
        let flat = flatten_server_classes(&schema).unwrap();
        assert_eq!(
            flat[0]
                .props
                .iter()
                .map(|p| p.path.as_str())
                .collect::<Vec<_>>(),
            ["base.nested", "local"]
        );
    }

    #[test]
    fn rejects_duplicate_table_names_before_flattening() {
        let duplicate = SendTableSchema {
            name: "DT_Duplicate".into(),
            needs_decoder: false,
            props: Vec::new(),
        };
        let schema = DataTableSchema {
            tables: vec![duplicate.clone(), duplicate],
            server_classes: Vec::new(),
            consumed_bits: 0,
        };
        assert!(
            flatten_server_classes(&schema)
                .unwrap_err()
                .contains("duplicate")
        );
    }
}
