import { decodeDemo } from "./decode.js";
import {
  decodeL4d2DataTables,
  flattenServerClasses,
  type FlattenedServerClass,
} from "./data-tables.js";
import {
  decodeInstanceBaselines,
  decodePacketEntityData,
  EntityReconstructor,
  type EntityFrame,
} from "./entities.js";
import { extractNetworkBits, inspectNetworkPayload } from "./network.js";
import { decodeStringTableSnapshot } from "./string-tables.js";
import {
  L4d2GameEventDecoder,
  projectRequiredGameEvent,
  type DecodedGameEvent,
  type RequiredGameEventProjection,
} from "./game-events.js";

export interface EntityFrameVisit {
  readonly demoTick: number;
  readonly engineTick: number;
  readonly frame: EntityFrame;
  readonly classes: readonly FlattenedServerClass[];
}

export interface EntityTelemetrySummary {
  readonly packetEntityFrames: number;
  readonly firstEngineTick: number | null;
  readonly lastEngineTick: number | null;
  readonly maximumEntities: number;
  readonly maximumTerrorPlayers: number;
}

export interface GameEventVisit {
  readonly demoTick: number;
  readonly engineTick: number | null;
  readonly event: DecodedGameEvent;
  readonly required: RequiredGameEventProjection | null;
}

export interface GameEventTelemetrySummary {
  readonly schemaLists: number;
  readonly schemas: number;
  readonly events: number;
  readonly requiredEvents: Readonly<Record<string, number>>;
}

/** Streams protocol-2100 game events without retaining payloads or identifiers. */
export function visitL4d2GameEvents(
  bytes: Uint8Array,
  visit: (value: GameEventVisit) => void = () => undefined,
): GameEventTelemetrySummary {
  const demo = decodeDemo(bytes);
  if (demo.header.demoProtocol !== 4 || demo.header.networkProtocol !== 2_100)
    throw new RangeError("game event decoding requires L4D2 protocol 2100");
  const decoder = new L4d2GameEventDecoder();
  let schemaLists = 0;
  let schemas = 0;
  let events = 0;
  const requiredEvents: Record<string, number> = {};
  for (const frame of demo.frames) {
    if (!frame.payload || (frame.kind !== "packet" && frame.kind !== "signon"))
      continue;
    const inspection = inspectNetworkPayload(frame.payload);
    if (!inspection.complete)
      throw new RangeError("network payload did not traverse completely");
    const tickMessages = inspection.messages.filter(
      ({ envelope }) => envelope?.kind === "tick",
    );
    const tickEnvelope =
      tickMessages.length === 1 ? tickMessages[0]!.envelope : undefined;
    const engineTick =
      tickEnvelope?.kind === "tick" ? tickEnvelope.value.engineTick : null;
    for (const message of inspection.messages) {
      const envelope = message.envelope;
      if (envelope?.kind === "game-event-list") {
        decoder.registerList(
          extractNetworkBits(
            frame.payload,
            envelope.value.dataStartBit,
            envelope.value.dataBitLength,
          ),
          envelope.value.dataBitLength,
          envelope.value.eventCount,
        );
        schemaLists += 1;
        schemas = decoder.schemas.size;
      } else if (envelope?.kind === "game-event") {
        const event = decoder.decode(
          extractNetworkBits(
            frame.payload,
            envelope.value.dataStartBit,
            envelope.value.dataBitLength,
          ),
          envelope.value.dataBitLength,
        );
        const eventTick = engineTick ?? frame.tick ?? 0;
        const required = projectRequiredGameEvent(event, eventTick);
        events += 1;
        if (required)
          requiredEvents[required.name] =
            (requiredEvents[required.name] ?? 0) + 1;
        visit({
          demoTick: frame.tick ?? eventTick,
          engineTick,
          event,
          required,
        });
      }
    }
  }
  return { schemaLists, schemas, events, requiredEvents };
}

/**
 * Reconstructs protocol-2100 entity state while retaining only bounded delta
 * history. Callers choose what derived observations to retain via `visit`.
 */
export function visitL4d2EntityFrames(
  bytes: Uint8Array,
  visit: (value: EntityFrameVisit) => void = () => undefined,
): EntityTelemetrySummary {
  const demo = decodeDemo(bytes);
  if (demo.header.demoProtocol !== 4 || demo.header.networkProtocol !== 2_100)
    throw new RangeError("entity reconstruction requires L4D2 protocol 2100");
  const dataTables = demo.frames.find(({ kind }) => kind === "data-tables");
  const stringTables = demo.frames.find(({ kind }) => kind === "string-tables");
  if (!dataTables?.payload || !stringTables?.payload)
    throw new RangeError("demo has no data-table or string-table snapshot");
  const classes = flattenServerClasses(
    decodeL4d2DataTables(dataTables.payload),
  );
  const baselineTable = decodeStringTableSnapshot(
    stringTables.payload,
  ).tables.find(({ name }) => name === "instancebaseline");
  if (!baselineTable)
    throw new RangeError("demo has no instancebaseline table");
  const reconstructor = new EntityReconstructor({
    instanceBaselines: decodeInstanceBaselines(baselineTable, classes),
    maxHistory: 4,
  });

  let packetEntityFrames = 0;
  let firstEngineTick: number | null = null;
  let lastEngineTick: number | null = null;
  let maximumEntities = 0;
  let maximumTerrorPlayers = 0;
  for (const demoFrame of demo.frames) {
    if (
      !demoFrame.payload ||
      (demoFrame.kind !== "packet" && demoFrame.kind !== "signon")
    )
      continue;
    const inspection = inspectNetworkPayload(demoFrame.payload);
    if (!inspection.complete)
      throw new RangeError("network payload did not traverse completely");
    const tickMessages = inspection.messages.filter(
      ({ envelope }) => envelope?.kind === "tick",
    );
    const entityMessages = inspection.messages.filter(
      ({ envelope }) => envelope?.kind === "packet-entities",
    );
    if (entityMessages.length === 0) continue;
    if (tickMessages.length !== 1 || entityMessages.length !== 1)
      throw new RangeError("ambiguous tick or PacketEntities message count");
    const tickEnvelope = tickMessages[0]!.envelope!;
    const packetEnvelope = entityMessages[0]!.envelope!;
    if (
      tickEnvelope.kind !== "tick" ||
      packetEnvelope.kind !== "packet-entities"
    )
      throw new RangeError("unexpected network envelope");
    const engineTick = tickEnvelope.value.engineTick;
    const envelope = packetEnvelope.value;
    const source =
      envelope.isDelta && envelope.deltaFrom !== null
        ? reconstructor.getFrame(envelope.deltaFrom)
        : undefined;
    const classByEntity = new Map(
      [...(source?.entities ?? [])].map(([index, entity]) => [
        index,
        entity.classId,
      ]),
    );
    const updates = decodePacketEntityData(
      extractNetworkBits(
        demoFrame.payload,
        envelope.dataStartBit,
        envelope.dataBitLength,
      ),
      envelope.updatedEntries,
      classes,
      classByEntity,
      {
        explicitDeletionList: envelope.isDelta,
        isDelta: envelope.isDelta,
        dataBitLength: envelope.dataBitLength,
        maxEntries: envelope.maxEntries,
      },
    );
    const frame = reconstructor.applyPacket(engineTick, envelope, updates);
    packetEntityFrames += 1;
    firstEngineTick ??= engineTick;
    lastEngineTick = engineTick;
    maximumEntities = Math.max(maximumEntities, frame.entities.size);
    maximumTerrorPlayers = Math.max(
      maximumTerrorPlayers,
      [...frame.entities.values()].filter(
        ({ active, classId }) =>
          active && classes[classId]?.className === "CTerrorPlayer",
      ).length,
    );
    visit({
      demoTick: demoFrame.tick ?? engineTick,
      engineTick,
      frame,
      classes,
    });
  }
  return {
    packetEntityFrames,
    firstEngineTick,
    lastEngineTick,
    maximumEntities,
    maximumTerrorPlayers,
  };
}
