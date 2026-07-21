export function config(overrides = {}) {
  const value = {
    schemaVersion: 2,
    parserConfig: "source1-l4d2-2100-v2",
    maxInputBytes: 512 * 1024 * 1024,
    maxObservations: 2_000_000,
    maxIdentityMappings: 16_384,
    maxMatchStates: 100_000,
    maxRawEvents: 2_000_000,
    maxRequiredEvents: 1_000_000,
    maxEventKinds: 4_096,
    maxOutputBytes: 256 * 1024 * 1024,
    ...overrides,
  };
  return Buffer.from(JSON.stringify(value), "utf8");
}
