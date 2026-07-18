import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startWorkerHeartbeat } from "./heartbeat.js";

describe("worker heartbeat", () => {
  it("writes a private, parseable liveness record immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "witchwatch-heartbeat-"));
    const path = join(root, "worker", "heartbeat.json");
    const heartbeat = startWorkerHeartbeat(path, 10_000);
    try {
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
        pid: process.pid,
      });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally {
      heartbeat.stop();
    }
  });

  it("rejects an interval too short to operate safely", () => {
    expect(() => startWorkerHeartbeat("ignored", 99)).toThrow(RangeError);
  });
});
