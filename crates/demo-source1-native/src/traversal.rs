use crate::demo::{DecodeOptions, DemoCommandKind, DemoDecodeResult, decode_demo};
use crate::error::ProjectError;
use crate::network::{NetworkLimits, NetworkPayloadInspection, inspect_network_payload};

#[cfg(test)]
thread_local! {
    static PREPARE_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A bounded, reusable view of one outer demo traversal. Network message
/// boundaries are inspected once and shared by all projection consumers.
pub(crate) struct PreparedDemo<'a> {
    pub demo: DemoDecodeResult<'a>,
    source: &'a [u8],
    inspections: Vec<Option<NetworkPayloadInspection>>,
}

impl<'a> PreparedDemo<'a> {
    pub fn new(bytes: &'a [u8]) -> Result<Self, ProjectError> {
        #[cfg(test)]
        PREPARE_COUNT.with(|count| count.set(count.get() + 1));
        let demo = decode_demo(bytes, DecodeOptions::default())
            .map_err(|error| ProjectError::from_demo(&error))?;
        if demo.header.demo_protocol != 4 {
            return Err(ProjectError {
                version: 1,
                code: crate::error::ProjectErrorCode::InvalidProtocol,
                stage: "framing".into(),
                offset: Some(8),
                message: "projection requires demo protocol 4".into(),
            });
        }
        if demo.header.network_protocol != 2100 {
            return Err(ProjectError {
                version: 1,
                code: crate::error::ProjectErrorCode::InvalidProtocol,
                stage: "framing".into(),
                offset: Some(12),
                message: "projection requires L4D2 network protocol 2100".into(),
            });
        }
        let mut inspections = Vec::with_capacity(demo.frames.len());
        for frame in &demo.frames {
            let inspection = if matches!(
                frame.kind,
                DemoCommandKind::Packet | DemoCommandKind::Signon
            ) {
                frame
                    .payload
                    .map(|payload| {
                        inspect_network_payload(payload, NetworkLimits::default()).map_err(
                            |message| {
                                ProjectError::classify_at("network", frame.payload_offset, message)
                            },
                        )
                    })
                    .transpose()?
            } else {
                None
            };
            inspections.push(inspection);
        }
        Ok(Self {
            demo,
            source: bytes,
            inspections,
        })
    }

    pub fn inspection(&self, frame_index: usize) -> Option<&NetworkPayloadInspection> {
        self.inspections.get(frame_index).and_then(Option::as_ref)
    }

    pub fn source_sha256(&self) -> String {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(self.source))
    }
}

#[cfg(test)]
pub(crate) fn reset_prepare_count() {
    PREPARE_COUNT.with(|count| count.set(0));
}

#[cfg(test)]
pub(crate) fn prepare_count() -> usize {
    PREPARE_COUNT.with(std::cell::Cell::get)
}
