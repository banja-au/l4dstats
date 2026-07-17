import type { Detector, DetectorCard } from "./types.js";

export class DetectorRegistry {
  readonly #detectors = new Map<string, Detector<unknown>>();
  register<Input>(detector: Detector<Input>): this {
    const key = `${detector.card.id}@${detector.card.version}`;
    if (this.#detectors.has(key)) throw new Error(`duplicate detector ${key}`);
    this.#detectors.set(key, detector as Detector<unknown>);
    return this;
  }
  get(id: string, version: string): Detector<unknown> | undefined {
    return this.#detectors.get(`${id}@${version}`);
  }
  cards(): readonly DetectorCard[] {
    return [...this.#detectors.values()]
      .map((d) => d.card)
      .sort(
        (a, b) =>
          a.id.localeCompare(b.id) || a.version.localeCompare(b.version),
      );
  }
}
