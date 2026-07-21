//! Bounded, clean-room Source 1 demo decoding primitives.

pub mod artifact;
pub mod bit_reader;
pub mod data_tables;
pub mod demo;
pub mod direct_wire;
pub mod entities;
pub mod error;
pub mod event_wire;
pub mod game_events;
pub mod identity;
pub mod network;
pub mod projection;
pub mod reader;
pub mod string_tables;
mod traversal;
pub mod usercmd;
pub mod wire;

pub use demo::{DecodeOptions, DemoDecodeResult, DemoParseError, decode_demo};
