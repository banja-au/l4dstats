import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INFECTED_CLASSES, InfectedIcon } from "./InfectedIcon";

describe("InfectedIcon", () => {
  it.each(INFECTED_CLASSES)("renders the realistic %s portrait", (kind) => {
    const markup = renderToStaticMarkup(<InfectedIcon infectedClass={kind} />);
    expect(markup).toContain(`data-infected-class="${kind}"`);
    expect(markup).toContain(`src="/art/si/${kind.toLowerCase()}.png"`);
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("<svg");
  });

  it("exposes a standalone accessible label", () => {
    const markup = renderToStaticMarkup(
      <InfectedIcon infectedClass="hunter" label="Hunter" />,
    );
    expect(markup).toContain('alt="Hunter"');
    expect(markup).not.toContain("aria-hidden");
  });

  it("renders nothing for unknown telemetry", () => {
    expect(renderToStaticMarkup(<InfectedIcon infectedClass="Unknown" />)).toBe(
      "",
    );
  });

  it("uses a unique portrait asset for every class", () => {
    const sources = INFECTED_CLASSES.map(
      (kind) => `/art/si/${kind.toLowerCase()}.png`,
    );
    expect(new Set(sources)).toHaveLength(INFECTED_CLASSES.length);
  });

  it.each(INFECTED_CLASSES)(
    "ships an optimized RGBA portrait for %s",
    async (kind) => {
      const path = fileURLToPath(
        new URL(
          `../../public/art/si/${kind.toLowerCase()}.png`,
          import.meta.url,
        ),
      );
      const png = await readFile(path);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(192);
      expect(png.readUInt32BE(20)).toBe(192);
      expect(png[25]).toBe(6);
    },
  );
});
