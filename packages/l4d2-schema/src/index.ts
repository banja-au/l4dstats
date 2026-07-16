import type { AvailableValue, PlayerEpoch } from "@witchwatch/contracts";

export interface PlayerConnection {
  readonly entitySlot: number;
  readonly tick: number;
  readonly userId?: number;
  readonly steamId?: string;
}

export interface PlayerDisconnection {
  readonly entitySlot: number;
  readonly tick: number;
}

export const unavailable = <T>(reason: string): AvailableValue<T> => ({
  availability: "unavailable",
  reason,
});
export const observed = <T>(value: T): AvailableValue<T> => ({
  availability: "observed",
  value,
});

const optionalObserved = <T>(
  value: T | undefined,
  reason: string,
): AvailableValue<T> =>
  value === undefined ? unavailable(reason) : observed(value);

export class PlayerEpochTracker {
  readonly #demoSha256: string;
  readonly #active = new Map<number, PlayerEpoch>();
  readonly #completed: PlayerEpoch[] = [];
  #sequence = 0;

  constructor(demoSha256: string) {
    this.#demoSha256 = demoSha256;
  }

  connect(connection: PlayerConnection): PlayerEpoch {
    const existing = this.#active.get(connection.entitySlot);
    if (existing)
      this.disconnect({
        entitySlot: connection.entitySlot,
        tick: connection.tick,
      });
    const epoch: PlayerEpoch = {
      id: `${this.#demoSha256}:${connection.entitySlot}:${connection.tick}:${this.#sequence++}`,
      demoSha256: this.#demoSha256,
      entitySlot: connection.entitySlot,
      userId: optionalObserved(
        connection.userId,
        "userinfo user ID was not decoded",
      ),
      steamId: optionalObserved(
        connection.steamId,
        "stable Steam identity was not decoded",
      ),
      connectedAtTick: connection.tick,
      disconnectedAtTick: unavailable(
        "connection remained active at end of decoded range",
      ),
    };
    this.#active.set(connection.entitySlot, epoch);
    return epoch;
  }

  disconnect(disconnection: PlayerDisconnection): void {
    const epoch = this.#active.get(disconnection.entitySlot);
    if (!epoch) return;
    this.#active.delete(disconnection.entitySlot);
    this.#completed.push({
      ...epoch,
      disconnectedAtTick: observed(disconnection.tick),
    });
  }

  finish(): readonly PlayerEpoch[] {
    return [...this.#completed, ...this.#active.values()].sort(
      (left, right) =>
        left.connectedAtTick - right.connectedAtTick ||
        left.entitySlot - right.entitySlot,
    );
  }
}
