use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BinaryReadErrorCode {
    OutOfBounds,
    InvalidLength,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BinaryReadError {
    pub code: BinaryReadErrorCode,
    pub offset: usize,
    pub requested_bytes: usize,
    pub available_bytes: usize,
}

impl fmt::Display for BinaryReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "need {} bytes at offset {}, only {} remain",
            self.requested_bytes, self.offset, self.available_bytes
        )
    }
}

impl std::error::Error for BinaryReadError {}

#[derive(Clone, Copy, Debug)]
pub struct BinaryReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> BinaryReader<'a> {
    #[must_use]
    pub const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    #[must_use]
    pub const fn offset(&self) -> usize {
        self.offset
    }
    #[must_use]
    pub const fn remaining(&self) -> usize {
        self.bytes.len() - self.offset
    }

    pub fn u8(&mut self) -> Result<u8, BinaryReadError> {
        self.require(1)?;
        let value = self.bytes[self.offset];
        self.offset += 1;
        Ok(value)
    }

    pub fn i32(&mut self) -> Result<i32, BinaryReadError> {
        Ok(i32::from_le_bytes(
            self.bytes(4)?.try_into().expect("checked length"),
        ))
    }

    pub fn f32(&mut self) -> Result<f32, BinaryReadError> {
        Ok(f32::from_le_bytes(
            self.bytes(4)?.try_into().expect("checked length"),
        ))
    }

    pub fn bytes(&mut self, length: usize) -> Result<&'a [u8], BinaryReadError> {
        self.require(length)?;
        let start = self.offset;
        self.offset += length;
        Ok(&self.bytes[start..self.offset])
    }

    pub fn fixed_latin1(&mut self, length: usize) -> Result<String, BinaryReadError> {
        let bytes = self.bytes(length)?;
        let end = bytes
            .iter()
            .position(|&byte| byte == 0)
            .unwrap_or(bytes.len());
        Ok(bytes[..end].iter().map(|&byte| latin1_char(byte)).collect())
    }

    fn require(&self, length: usize) -> Result<(), BinaryReadError> {
        if length > self.remaining() {
            return Err(BinaryReadError {
                code: BinaryReadErrorCode::OutOfBounds,
                offset: self.offset,
                requested_bytes: length,
                available_bytes: self.remaining(),
            });
        }
        Ok(())
    }
}
pub(crate) const fn latin1_char(byte: u8) -> char {
    const C: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    if byte >= 0x80 && byte <= 0x9f {
        C[(byte - 0x80) as usize]
    } else {
        byte as char
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_views_and_little_endian_without_advancing_on_failure() {
        let mut reader = BinaryReader::new(&[0xff, 1, 0, 0, 0, b'A', 0, b'B'][1..]);
        assert_eq!(reader.i32().unwrap(), 1);
        assert_eq!(reader.fixed_latin1(3).unwrap(), "A");
        let offset = reader.offset();
        assert_eq!(reader.i32().unwrap_err().offset, offset);
        assert_eq!(reader.offset(), offset);
    }
}
