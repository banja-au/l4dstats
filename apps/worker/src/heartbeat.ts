import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface WorkerHeartbeat {
  readonly path: string;
  stop(): void;
}

export function startWorkerHeartbeat(
  path: string,
  intervalMilliseconds = 5_000,
): WorkerHeartbeat {
  if (!Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 100)
    throw new RangeError("worker heartbeat interval must be at least 100ms");
  mkdirSync(dirname(path), { recursive: true });
  const write = () =>
    writeFileSync(
      path,
      `${JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() })}\n`,
      { mode: 0o600 },
    );
  write();
  const timer = setInterval(write, intervalMilliseconds);
  return {
    path,
    stop: () => clearInterval(timer),
  };
}
