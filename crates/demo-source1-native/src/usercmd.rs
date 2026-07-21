use crate::bit_reader::BitReader;
use serde::Serialize;

/// Bounded, clean-room projection of the L4D2 protocol-2100 `CUserCmd` delta
/// carried by a `dem_usercmd` frame. These are submitted command values, not
/// proof that movement, a weapon shot, or an interaction occurred.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCommand {
    pub command_number: i32,
    pub tick_count: i32,
    pub view_angles: [f32; 3],
    pub forward_move: f32,
    pub side_move: f32,
    pub up_move: f32,
    pub buttons: u32,
    pub impulse: u8,
    pub weapon_select: Option<u32>,
    pub weapon_subtype: Option<u32>,
    pub mouse_dx: i16,
    pub mouse_dy: i16,
    pub consumed_bits: usize,
    pub source_bits: usize,
}

#[allow(clippy::similar_names)]
pub fn decode_user_command(bytes: &[u8]) -> Result<UserCommand, String> {
    if bytes.len() > 1024 {
        return Err("user-command payload exceeds 1024-byte limit".into());
    }
    let mut reader = BitReader::new(bytes);
    let command_number = changed_i32(&mut reader, 0)?;
    let tick_count = changed_i32(&mut reader, 0)?;
    let view_angles = [
        changed_f32(&mut reader, 0.0)?,
        changed_f32(&mut reader, 0.0)?,
        changed_f32(&mut reader, 0.0)?,
    ];
    let forward_move = changed_f32(&mut reader, 0.0)?;
    let side_move = changed_f32(&mut reader, 0.0)?;
    let up_move = changed_f32(&mut reader, 0.0)?;
    let buttons = if reader.read_bool().map_err(text)? {
        reader.read_bits(32).map_err(text)?
    } else {
        0
    };
    let impulse = if reader.read_bool().map_err(text)? {
        u8::try_from(reader.read_bits(8).map_err(text)?).expect("8-bit value")
    } else {
        0
    };
    let (weapon_select, weapon_subtype) = if reader.read_bool().map_err(text)? {
        let select = reader.read_bits(11).map_err(text)?;
        let subtype = reader
            .read_bool()
            .map_err(text)?
            .then(|| reader.read_bits(6).map_err(text))
            .transpose()?;
        (Some(select), subtype)
    } else {
        (None, None)
    };
    let mouse_dx = changed_i16(&mut reader, 0)?;
    let mouse_dy = changed_i16(&mut reader, 0)?;
    let consumed_bits = reader.bit_offset();
    // The outer demo command stores a byte length rather than an exact bit
    // length. At most seven unused high bits may remain in the final byte;
    // inspected L4D2 recordings do not guarantee those container padding bits
    // are zero, so they are excluded from the decoded command semantics.
    if reader.remaining_bits() > 7 {
        return Err("user-command payload has trailing bytes".into());
    }
    Ok(UserCommand {
        command_number,
        tick_count,
        view_angles,
        forward_move,
        side_move,
        up_move,
        buttons,
        impulse,
        weapon_select,
        weapon_subtype,
        mouse_dx,
        mouse_dy,
        consumed_bits,
        source_bits: bytes.len() * 8,
    })
}

fn changed_i32(reader: &mut BitReader<'_>, unchanged: i32) -> Result<i32, String> {
    if reader.read_bool().map_err(text)? {
        Ok(i32::from_le_bytes(
            reader.read_bits(32).map_err(text)?.to_le_bytes(),
        ))
    } else {
        Ok(unchanged)
    }
}

fn changed_i16(reader: &mut BitReader<'_>, unchanged: i16) -> Result<i16, String> {
    if reader.read_bool().map_err(text)? {
        let raw = u16::try_from(reader.read_bits(16).map_err(text)?).expect("16-bit value");
        Ok(i16::from_le_bytes(raw.to_le_bytes()))
    } else {
        Ok(unchanged)
    }
}

fn changed_f32(reader: &mut BitReader<'_>, unchanged: f32) -> Result<f32, String> {
    if reader.read_bool().map_err(text)? {
        let value = reader.read_f32().map_err(text)?;
        if !value.is_finite() {
            return Err("user-command contains a non-finite float".into());
        }
        Ok(value)
    } else {
        Ok(unchanged)
    }
}

#[allow(clippy::needless_pass_by_value)]
fn text(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_an_all_default_command() {
        // Thirteen unchanged flags, rounded to two zero bytes.
        let decoded = decode_user_command(&[0, 0]).unwrap();
        assert_eq!(decoded.command_number, 0);
        assert_eq!(decoded.tick_count, 0);
        assert_eq!(decoded.weapon_select, None);
        assert_eq!(decoded.consumed_bits, 13);
        assert_eq!(decoded.source_bits, 16);
    }

    #[test]
    fn rejects_truncation_and_trailing_bytes() {
        assert!(decode_user_command(&[]).unwrap_err().contains("bit"));
        assert!(
            decode_user_command(&[0, 0, 0])
                .unwrap_err()
                .contains("trailing")
        );
    }

    #[test]
    fn enforces_payload_limit() {
        assert!(
            decode_user_command(&vec![0; 1025])
                .unwrap_err()
                .contains("limit")
        );
    }
}
