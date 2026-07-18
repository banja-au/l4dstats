import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visitL4d2EntityFrames } from "@witchwatch/demo-source1";
import { describe, expect, it } from "vitest";
import {
  L4d2PlayerProjector,
  type L4d2WitchObservation,
} from "./entity-projection";

const corpusDemo = resolve(
  "../../data/sprint-1-corpus/extracted/901780_c2m1_highway/901780_c2m1_highway.dem",
);
const stop = new Error("witch observation captured");

describe.runIf(existsSync(corpusDemo))("real Witch entity projection", () => {
  it("retains rage while keeping cell-relative origin out of world geometry", () => {
    const bytes = readFileSync(corpusDemo);
    let captured: L4d2WitchObservation | undefined;
    const projector = new L4d2PlayerProjector({
      demoSha256: createHash("sha256").update(bytes).digest("hex"),
      userInfo: [],
      onWitchObservation: (observation) => {
        if (
          observation.rage === undefined ||
          observation.cellRelativeOrigin === undefined
        )
          return;
        captured = observation;
        throw stop;
      },
    });
    try {
      visitL4d2EntityFrames(bytes, (frame) => projector.visit(frame));
    } catch (error) {
      if (error !== stop) throw error;
    }
    expect(captured).toMatchObject({
      entityIndex: expect.any(Number),
      lifetime: expect.any(Number),
      tick: expect.any(Number),
      rage: expect.any(Number),
      cellRelativeOrigin: {
        x: expect.any(Number),
        y: expect.any(Number),
        z: expect.any(Number),
      },
    });
    expect(captured).not.toHaveProperty("position");
  }, 30_000);
});
