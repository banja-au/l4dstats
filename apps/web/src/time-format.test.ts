import { describe, expect, it } from "vitest";
import { formatElapsedTime, formatTickTime } from "./time-format";

describe("timeline time formatting", () => {
  it("renders elapsed time with millisecond precision", () => {
    expect(formatElapsedTime(61.1234)).toBe("1:01.123");
    expect(formatElapsedTime(3_661.005)).toBe("1:01:01.005");
  });

  it("converts ticks only with an available positive tick rate", () => {
    expect(formatTickTime(1_834, 30)).toBe("1:01.133");
    expect(formatTickTime(9_000, null)).toBe("tick 9,000");
    expect(formatTickTime(9_000, 0)).toBe("tick 9,000");
  });
});
