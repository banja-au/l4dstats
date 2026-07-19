import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { engineCommand, validateNativeParserAttestation } from "./engine.js";
import {
  isSupportedDemoFilename,
  prepareUploadedDemo,
} from "@l4dstats/acquisition";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;
const PARSER_TIMEOUT_MS = 5 * 60 * 1_000;
const SHA256 = /^[a-f0-9]{64}$/;
const DEMO_LIMITS = {
  maxSourceBytes: MAX_SOURCE_BYTES,
  maxDemoBytes: MAX_SOURCE_BYTES,
  maxCompressionRatio: 100,
  maxZipEntries: 16,
  timeoutMs: 30_000,
} as const;

async function requestBytes(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of request) {
    const chunk = Buffer.from(value as Uint8Array);
    total += chunk.byteLength;
    if (total > MAX_SOURCE_BYTES) throw new Error("source exceeds byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function analyze(path: string): Promise<Uint8Array> {
  const invocation = engineCommand(path, true);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: "/workspace",
      env: {
        CI: "true",
        LANG: process.env.LANG ?? "C.UTF-8",
        NODE_ENV: "production",
        NODE_OPTIONS: "--conditions=production",
        PATH: process.env.PATH,
        TMPDIR: process.env.L4DSTATS_CONTAINER_WORK_ROOT ?? "/tmp/l4dstats",
        TZ: "UTC",
        L4DSTATS_PSEUDONYM_KEY: process.env.L4DSTATS_PSEUDONYM_KEY ?? "",
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let errors = "";
    let settled = false;
    const finish = (error?: Error, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolvePromise(bytes!);
    };
    const terminate = (error: Error) => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } finally {
        finish(error);
      }
    };
    const timeout = setTimeout(
      () => terminate(new Error("parser exceeded wall-clock limit")),
      PARSER_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_RESULT_BYTES)
        terminate(new Error("parser result exceeds byte limit"));
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.length < MAX_ERROR_BYTES)
        errors += chunk
          .toString("utf8")
          .slice(0, MAX_ERROR_BYTES - errors.length);
    });
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(`parser exited ${code ?? "by signal"}: ${errors}`));
        return;
      }
      try {
        const bytes = Buffer.concat(output);
        const result = JSON.parse(bytes.toString("utf8"));
        validateNativeParserAttestation(result);
        finish(undefined, bytes);
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error("parser result is invalid"),
        );
      }
    });
  });
}

const workRoot = resolve(
  process.env.L4DSTATS_CONTAINER_WORK_ROOT ?? "/tmp/l4dstats",
);
await mkdir(workRoot, { recursive: true });

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://container");
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}\n');
      return;
    }
    if (
      request.method !== "POST" ||
      !/^\/jobs\/[a-f0-9-]+$/.test(url.pathname)
    ) {
      response.writeHead(404).end();
      return;
    }
    const expectedSha256 = request.headers["x-content-sha256"];
    if (typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256))
      throw new Error("source SHA-256 header is invalid");
    const declaredBytes = Number(request.headers["content-length"]);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 1 ||
      declaredBytes > MAX_SOURCE_BYTES
    )
      throw new Error("source content length is invalid");
    const sourceFilename = request.headers["x-source-filename"];
    if (
      typeof sourceFilename !== "string" ||
      !isSupportedDemoFilename(sourceFilename)
    )
      throw new Error("source filename is invalid or unsupported");
    if (!process.env.L4DSTATS_PSEUDONYM_KEY)
      throw new Error("analysis pseudonym key is unavailable");
    const directory = join(workRoot, randomUUID());
    const path = join(directory, "source.dem");
    await mkdir(directory, { mode: 0o700 });
    try {
      const bytes = await requestBytes(request);
      if (bytes.byteLength !== declaredBytes)
        throw new Error("source body is incomplete");
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== expectedSha256)
        throw new Error("source SHA-256 verification failed");
      const prepared = await prepareUploadedDemo(
        sourceFilename,
        bytes,
        DEMO_LIMITS,
      );
      await writeFile(path, prepared.bytes, { flag: "wx", mode: 0o600 });
      const result = await analyze(path);
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(result.byteLength),
        "cache-control": "no-store",
      });
      response.end(result);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch (error) {
    response.writeHead(422, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : "analysis failed",
      })}\n`,
    );
  }
}).listen(8080, "0.0.0.0");
