use crate::reader::latin1_char;
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BitReadErrorCode {
    OutOfBounds,
    InvalidLength,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BitReadError {
    pub code: BitReadErrorCode,
    pub bit_offset: usize,
    pub requested_bits: usize,
    pub available_bits: usize,
}

impl fmt::Display for BitReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "need {} bits at bit {}, only {} remain",
            self.requested_bits, self.bit_offset, self.available_bits
        )
    }
}
impl std::error::Error for BitReadError {}

#[derive(Clone, Copy, Debug)]
pub struct BitReader<'a> {
    bytes: &'a [u8],
    bit_offset: usize,
    bit_end: usize,
}

impl<'a> BitReader<'a> {
    #[must_use]
    pub const fn new(bytes: &'a [u8]) -> Self {
        Self {
            bytes,
            bit_offset: 0,
            bit_end: bytes.len() * 8,
        }
    }

    pub fn span(
        bytes: &'a [u8],
        start_bit: usize,
        bit_length: usize,
    ) -> Result<Self, BitReadError> {
        let bit_end = start_bit
            .checked_add(bit_length)
            .ok_or_else(|| invalid(start_bit, bit_length, 0))?;
        if bit_end > bytes.len() * 8 {
            return Err(out(start_bit, bit_length, bytes.len() * 8));
        }
        Ok(Self {
            bytes,
            bit_offset: start_bit,
            bit_end,
        })
    }

    #[must_use]
    pub const fn bit_offset(&self) -> usize {
        self.bit_offset
    }
    #[must_use]
    pub const fn remaining_bits(&self) -> usize {
        self.bit_end - self.bit_offset
    }

    pub fn read_bits(&mut self, length: usize) -> Result<u32, BitReadError> {
        self.require(length, 32)?;
        let mut value = 0_u32;
        for bit in 0..length {
            let absolute = self.bit_offset + bit;
            value |= u32::from((self.bytes[absolute >> 3] >> (absolute & 7)) & 1) << bit;
        }
        self.bit_offset += length;
        Ok(value)
    }

    pub fn read_bool(&mut self) -> Result<bool, BitReadError> {
        Ok(self.read_bits(1)? == 1)
    }

    pub fn read_signed_bits(&mut self, length: usize) -> Result<i64, BitReadError> {
        if length == 0 {
            return Ok(0);
        }
        let value = i64::from(self.read_bits(length)?);
        let sign = 1_i64 << (length - 1);
        Ok(if value >= sign {
            value - (1_i64 << length)
        } else {
            value
        })
    }

    pub fn read_ubit_var(&mut self) -> Result<u32, BitReadError> {
        let head = self.read_bits(6)?;
        Ok(match head & 0x30 {
            0x10 => (head & 0x0f) | (self.read_bits(4)? << 4),
            0x20 => (head & 0x0f) | (self.read_bits(8)? << 4),
            0x30 => (head & 0x0f) + self.read_bits(28)? * 16,
            _ => head,
        })
    }

    pub fn read_f32(&mut self) -> Result<f32, BitReadError> {
        Ok(f32::from_bits(self.read_bits(32)?))
    }
    pub fn read_bytes(&mut self, length: usize) -> Result<Vec<u8>, BitReadError> {
        let bits = length
            .checked_mul(8)
            .ok_or_else(|| invalid(self.bit_offset, usize::MAX, self.remaining_bits()))?;
        self.require(bits, usize::MAX)?;
        let mut output = Vec::with_capacity(length);
        for _ in 0..length {
            output.push(u8::try_from(self.read_bits(8)?).expect("eight-bit value"));
        }
        Ok(output)
    }
    pub fn read_latin1(&mut self, length: usize) -> Result<String, BitReadError> {
        Ok(self
            .read_bytes(length)?
            .into_iter()
            .map(latin1_char)
            .collect())
    }

    pub fn skip_bits(&mut self, length: usize) -> Result<(), BitReadError> {
        self.require(length, usize::MAX)?;
        self.bit_offset += length;
        Ok(())
    }

    pub fn read_latin1_z(&mut self, max_bytes: usize) -> Result<String, BitReadError> {
        if max_bytes == 0 {
            return Err(invalid(self.bit_offset, 8, self.remaining_bits()));
        }
        let mut output = String::new();
        for _ in 0..max_bytes {
            let byte = u8::try_from(self.read_bits(8)?).expect("eight-bit value");
            if byte == 0 {
                return Ok(output);
            }
            output.push(latin1_char(byte));
        }
        Err(invalid(self.bit_offset, 8, self.remaining_bits()))
    }

    fn require(&self, length: usize, maximum: usize) -> Result<(), BitReadError> {
        if length > maximum {
            return Err(invalid(self.bit_offset, length, self.remaining_bits()));
        }
        if length > self.remaining_bits() {
            return Err(out(self.bit_offset, length, self.remaining_bits()));
        }
        Ok(())
    }
}

const fn out(offset: usize, requested: usize, available: usize) -> BitReadError {
    BitReadError {
        code: BitReadErrorCode::OutOfBounds,
        bit_offset: offset,
        requested_bits: requested,
        available_bits: available,
    }
}
const fn invalid(offset: usize, requested: usize, available: usize) -> BitReadError {
    BitReadError {
        code: BitReadErrorCode::InvalidLength,
        bit_offset: offset,
        requested_bits: requested,
        available_bits: available,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_lsb_first_across_bytes() {
        let mut r = BitReader::new(&[0b1010_0101, 1]);
        assert_eq!(r.read_bits(4).unwrap(), 5);
        assert_eq!(r.read_bits(5).unwrap(), 26);
    }
    #[test]
    fn bounded_span_and_failure_do_not_advance() {
        let mut r = BitReader::span(&[0xff], 2, 3).unwrap();
        assert_eq!(r.read_bits(3).unwrap(), 7);
        let at = r.bit_offset();
        assert_eq!(
            r.read_bits(1).unwrap_err().code,
            BitReadErrorCode::OutOfBounds
        );
        assert_eq!(r.bit_offset(), at);
    }
    #[test]
    fn reads_unaligned_string() {
        let bytes = [0b1000_0010, 0, 0];
        let mut r = BitReader::new(&bytes);
        r.skip_bits(1).unwrap();
        assert_eq!(r.read_latin1_z(2).unwrap(), "A");
    }
}
