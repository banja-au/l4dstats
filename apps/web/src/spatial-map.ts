import type { MatchTimelineEvent } from "./api";

export interface ScreenPoint {
  x: number;
  y: number;
  index: number;
}

export interface ScreenPointHit {
  index: number;
  distance: number;
  candidatesExamined: number;
}

export interface ScreenPointIndex {
  nearest(x: number, y: number, radius: number): ScreenPointHit | undefined;
}

/**
 * Indexes projected markers into fixed screen-space cells. Map movement rebuilds
 * the index once per rendered frame; pointer hover then examines only nearby
 * cells instead of sorting the complete event list on every movement.
 */
export function buildScreenPointIndex(
  points: readonly ScreenPoint[],
  cellSize = 36,
): ScreenPointIndex {
  const size = Math.max(8, cellSize);
  const cells = new Map<string, ScreenPoint[]>();
  const coordinate = (value: number) => Math.floor(value / size);
  const key = (column: number, row: number) => `${column}:${row}`;
  for (const point of points) {
    const cellKey = key(coordinate(point.x), coordinate(point.y));
    const cell = cells.get(cellKey);
    if (cell) cell.push(point);
    else cells.set(cellKey, [point]);
  }
  return {
    nearest(x, y, radius) {
      const boundedRadius = Math.max(0, radius);
      const reach = Math.ceil(boundedRadius / size);
      const centerColumn = coordinate(x);
      const centerRow = coordinate(y);
      const maximumDistanceSquared = boundedRadius * boundedRadius;
      let nearest: ScreenPoint | undefined;
      let nearestDistanceSquared = maximumDistanceSquared;
      let candidatesExamined = 0;
      for (
        let column = centerColumn - reach;
        column <= centerColumn + reach;
        column += 1
      ) {
        for (let row = centerRow - reach; row <= centerRow + reach; row += 1) {
          for (const point of cells.get(key(column, row)) ?? []) {
            candidatesExamined += 1;
            const dx = point.x - x;
            const dy = point.y - y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared <= nearestDistanceSquared) {
              nearest = point;
              nearestDistanceSquared = distanceSquared;
            }
          }
        }
      }
      return nearest
        ? {
            index: nearest.index,
            distance: Math.sqrt(nearestDistanceSquared),
            candidatesExamined,
          }
        : undefined;
    },
  };
}

/**
 * Returns the player whose observed position was retained on a timeline event.
 * Undefined is intentional: some positions describe an entity or a prior pin
 * location and cannot honestly be attributed to either displayed participant.
 */
export function spatialSubjectPlayerId(
  event: MatchTimelineEvent,
): string | undefined {
  switch (event.type) {
    case "death":
    case "incap":
      return event.victimPlayerId;
    case "spawn":
    case "attack":
    case "tank_control":
    case "revive":
    case "pin_start":
    case "pin_end":
      return event.actorPlayerId;
    case "clear":
    case "round_start":
    case "round_end":
    case "team_change":
    case "witch_spawn":
    case "witch_enrage":
    case "witch_burn":
    case "witch_end":
      return undefined;
  }
}
