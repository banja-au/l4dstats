import { describe, expect, it } from "vitest";
import { resolveLocale } from "./i18n";

describe("locale resolution", () => {
  it("prefers the explicit local override, then the persisted cookie", () => {
    expect(resolveLocale("en", "l4dstats_locale=es", ["es-ES"])).toBe("en");
    expect(
      resolveLocale(null, "theme=dark; l4dstats_locale=es", ["en-US"]),
    ).toBe("es");
  });

  it("uses the first supported browser language in preference order", () => {
    expect(resolveLocale(null, "", ["en-AU", "es-ES"])).toBe("en");
    expect(resolveLocale(null, "", ["fr-FR", "es-MX", "en-US"])).toBe("es");
    expect(resolveLocale(null, "", ["fr-FR"])).toBe("en");
  });
});
