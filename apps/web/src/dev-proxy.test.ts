import { describe, expect, it, vi } from "vitest";
import { applyApiProxyHeaders } from "./dev-proxy";

describe("development API proxy", () => {
  it("replaces browser Basic authentication with the internal Bearer token", () => {
    const setHeader = vi.fn();
    const removeHeader = vi.fn();
    applyApiProxyHeaders({ setHeader, removeHeader }, "shared-api-token");
    expect(setHeader).toHaveBeenCalledWith(
      "authorization",
      "Bearer shared-api-token",
    );
    expect(removeHeader.mock.calls).toEqual([
      ["x-witchwatch-user"],
      ["x-witchwatch-role"],
    ]);
  });
});
