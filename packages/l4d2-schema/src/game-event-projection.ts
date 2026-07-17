import {
  observationSchemaVersion,
  type AvailableValue,
  type GameEventObservation,
  type PlayerEpoch,
} from "@witchwatch/contracts";
import {
  visitL4d2GameEvents,
  type EventFieldAvailability,
  type GameEventVisit,
  type RequiredGameEventName,
  type RequiredGameEventProjection,
} from "@witchwatch/demo-source1";

export interface GameEventProjectionOptions {
  readonly demoSha256: string;
  /** Optional completed epoch set used to resolve event user IDs at event tick. */
  readonly playerEpochs?: readonly PlayerEpoch[];
  /** Streaming sink; projected events are not retained. */
  readonly onEvent?: (event: ProjectedGameEventObservation) => void;
}

export interface EventIdentityCorrelation {
  readonly userId: EventFieldAvailability<number>;
  readonly playerEpochId: AvailableValue<string>;
}

export interface ProjectedGameEventObservation {
  readonly observation: GameEventObservation;
  /** Role-aware decoded fields retain their protocol provenance and absence reasons. */
  readonly required: RequiredGameEventProjection;
  /** Ready-to-consume identity joins; never assumes entity slot equals user ID. */
  readonly identities: {
    readonly actor: EventIdentityCorrelation;
    readonly victim: EventIdentityCorrelation;
    readonly attacker: EventIdentityCorrelation;
  };
  readonly tickProvenance: "net_Tick.engineTick" | "demo-command.tick-fallback";
}

export interface GameEventProjectionCoverage {
  readonly decodedEvents: number;
  readonly requiredEvents: number;
  readonly emittedByName: Readonly<Record<RequiredGameEventName, number>>;
  readonly epochJoins: {
    readonly resolved: number;
    readonly unavailable: number;
  };
}

export interface GameEventProjectionResult {
  readonly coverage: GameEventProjectionCoverage;
}

/** Schema adapter from decoded protocol events to append-compatible observation v1. */
export class L4d2GameEventProjector {
  readonly #options: GameEventProjectionOptions;
  readonly #epochsByUserId: ReadonlyMap<number, readonly PlayerEpoch[]>;
  readonly #emittedByName: Record<RequiredGameEventName, number> = {
    weapon_fire: 0,
    player_hurt: 0,
    player_death: 0,
  };
  #decodedEvents = 0;
  #requiredEvents = 0;
  #resolved = 0;
  #unavailable = 0;

  constructor(options: GameEventProjectionOptions) {
    if (!/^[a-f\d]{64}$/i.test(options.demoSha256))
      throw new RangeError(
        "demoSha256 must be a 64-character hexadecimal digest",
      );
    this.#options = options;
    this.#epochsByUserId = indexEpochs(
      options.playerEpochs ?? [],
      options.demoSha256,
    );
  }

  visit(value: GameEventVisit): ProjectedGameEventObservation | null {
    this.#decodedEvents += 1;
    if (!value.required) return null;
    const required = value.required;
    const projected: ProjectedGameEventObservation = {
      observation: {
        schemaVersion: observationSchemaVersion,
        demoSha256: this.#options.demoSha256,
        tick: required.tick,
        name: required.name,
        fields: { ...value.event.fields },
      },
      required,
      identities: {
        actor: this.#correlate(required.actorUserId, required.tick),
        victim: this.#correlate(required.victimUserId, required.tick),
        attacker: this.#correlate(required.attackerUserId, required.tick),
      },
      tickProvenance:
        value.engineTick === null
          ? "demo-command.tick-fallback"
          : "net_Tick.engineTick",
    };
    this.#requiredEvents += 1;
    this.#emittedByName[required.name] += 1;
    this.#options.onEvent?.(projected);
    return projected;
  }

  finish(): GameEventProjectionResult {
    return {
      coverage: {
        decodedEvents: this.#decodedEvents,
        requiredEvents: this.#requiredEvents,
        emittedByName: { ...this.#emittedByName },
        epochJoins: {
          resolved: this.#resolved,
          unavailable: this.#unavailable,
        },
      },
    };
  }

  #correlate(
    userId: EventFieldAvailability<number>,
    tick: number,
  ): EventIdentityCorrelation {
    if (userId.availability !== "observed" || userId.value === undefined) {
      this.#unavailable += 1;
      return {
        userId,
        playerEpochId: unavailable(
          userId.reason ?? "event user ID is unavailable",
        ),
      };
    }
    const candidates = (this.#epochsByUserId.get(userId.value) ?? []).filter(
      (epoch) => containsTick(epoch, tick),
    );
    if (candidates.length !== 1) {
      this.#unavailable += 1;
      return {
        userId,
        playerEpochId: unavailable(
          candidates.length === 0
            ? "no player epoch matches this user ID at the event tick"
            : "multiple player epochs match this user ID at the event tick",
        ),
      };
    }
    this.#resolved += 1;
    return {
      userId,
      playerEpochId: { availability: "derived", value: candidates[0]!.id },
    };
  }
}

/** Runs the decoder and schema adapter while retaining only caller-selected events. */
export function projectL4d2GameEvents(
  bytes: Uint8Array,
  options: GameEventProjectionOptions,
): GameEventProjectionResult {
  const projector = new L4d2GameEventProjector(options);
  visitL4d2GameEvents(bytes, (value) => projector.visit(value));
  return projector.finish();
}

function indexEpochs(
  epochs: readonly PlayerEpoch[],
  demoSha256: string,
): ReadonlyMap<number, readonly PlayerEpoch[]> {
  const result = new Map<number, PlayerEpoch[]>();
  for (const epoch of epochs) {
    if (epoch.demoSha256 !== demoSha256)
      throw new RangeError("player epoch belongs to a different demo");
    if (
      epoch.userId.availability === "unavailable" ||
      epoch.userId.value === undefined
    )
      continue;
    const values = result.get(epoch.userId.value) ?? [];
    values.push(epoch);
    result.set(epoch.userId.value, values);
  }
  return result;
}

function containsTick(epoch: PlayerEpoch, tick: number): boolean {
  if (tick < epoch.connectedAtTick) return false;
  return (
    epoch.disconnectedAtTick.availability === "unavailable" ||
    epoch.disconnectedAtTick.value === undefined ||
    tick <= epoch.disconnectedAtTick.value
  );
}

function unavailable<T>(reason: string): AvailableValue<T> {
  return { availability: "unavailable", reason };
}
