import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync } from "node:fs";
import {
  telemetryLimits,
  type ReviewStatus,
  type WorkbenchRepository,
} from "@witchwatch/storage";
import { exportReport } from "./report.js";
import { validateSource, type IngestionPolicy } from "./validation.js";

const MAX_BODY = 64 * 1024;
const TERMINAL_JOB_STATES = new Set(["succeeded", "failed", "cancelled"]);
const openApiDocument = JSON.parse(
  readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
) as unknown;
async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("request body is too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("request body must be valid JSON");
  }
}
function send(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

export function createApi(
  repo: WorkbenchRepository,
  policy: IngestionPolicy,
  options: { ssePollIntervalMs?: number } = {},
) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost"),
        parts = url.pathname.split("/").filter(Boolean);
      if (request.method === "GET" && url.pathname === "/health") {
        send(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/openapi.json") {
        send(response, 200, openApiDocument);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/jobs") {
        const input = (await body(request)) as Record<string, unknown>,
          source = await validateSource(input.source, policy);
        const key =
          typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
        send(response, 202, repo.enqueue(source, key));
        return;
      }
      if (parts[0] === "api" && parts[1] === "jobs" && parts[2]) {
        const job = repo.getJob(parts[2]);
        if (!job) {
          send(response, 404, { error: "job not found" });
          return;
        }
        if (request.method === "GET" && parts.length === 3) {
          send(response, 200, job);
          return;
        }
        if (request.method === "POST" && parts[3] === "cancel") {
          send(response, 200, repo.cancel(job.id));
          return;
        }
        if (request.method === "POST" && parts[3] === "retry") {
          send(response, 200, repo.retry(job.id));
          return;
        }
        if (request.method === "GET" && parts[3] === "events") {
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          response.flushHeaders();
          let lastSignature = "";
          const emit = () => {
            const current = repo.getJob(job.id);
            if (!current) {
              response.end();
              return;
            }
            const signature = JSON.stringify(current);
            if (signature !== lastSignature) {
              response.write(`event: progress\ndata: ${signature}\n\n`);
              lastSignature = signature;
            }
            if (TERMINAL_JOB_STATES.has(current.state)) {
              clearInterval(timer);
              response.end();
            }
          };
          const timer = setInterval(emit, options.ssePollIntervalMs ?? 250);
          timer.unref();
          response.once("close", () => clearInterval(timer));
          emit();
          return;
        }
      }
      if (request.method === "GET" && url.pathname === "/api/cases") {
        send(response, 200, {
          items: repo.listCases(
            Number(url.searchParams.get("limit") ?? 50),
            Number(url.searchParams.get("offset") ?? 0),
          ),
        });
        return;
      }
      if (parts[0] === "api" && parts[1] === "cases" && parts[2]) {
        const caseId = parts[2];
        if (request.method === "GET" && parts.length === 3) {
          const found = repo.getCase(caseId);
          send(
            response,
            found ? 200 : 404,
            found
              ? {
                  ...found,
                  score: JSON.parse(found.scoreJson) as unknown,
                  presentation: repo.getCasePresentation(caseId),
                  lineage: repo.getCaseLineage(caseId),
                }
              : { error: "case not found" },
          );
          return;
        }
        if (request.method === "POST" && parts[3] === "notes") {
          const input = (await body(request)) as Record<string, unknown>;
          send(
            response,
            201,
            repo.addNote(
              caseId,
              String(input.body ?? ""),
              input.tick === null || input.tick === undefined
                ? null
                : Number(input.tick),
            ),
          );
          return;
        }
        if (request.method === "GET" && parts[3] === "notes") {
          send(response, 200, { items: repo.listNotes(caseId) });
          return;
        }
        if (request.method === "PATCH" && parts[3] === "review-status") {
          const input = (await body(request)) as Record<string, unknown>;
          send(
            response,
            200,
            repo.updateCaseStatus(caseId, String(input.status) as ReviewStatus),
          );
          return;
        }
        if (request.method === "GET" && parts[3] === "telemetry") {
          const start = Number(url.searchParams.get("start")),
            end = Number(url.searchParams.get("end")),
            demoSha256 = url.searchParams.get("demo") ?? undefined;
          if (demoSha256 !== undefined && !/^[a-f0-9]{64}$/.test(demoSha256))
            throw new RangeError("demo must be a SHA-256 digest");
          const telemetryResponse = {
            caseId,
            startTick: start,
            endTick: end,
            chunks: repo.getWindow(
              caseId,
              start,
              end,
              telemetryLimits.maxQueryTicks,
              demoSha256,
            ),
          };
          if (
            Buffer.byteLength(JSON.stringify(telemetryResponse)) >
            telemetryLimits.maxResponseBytes
          )
            throw new RangeError("telemetry response exceeds the byte limit");
          send(response, 200, telemetryResponse);
          return;
        }
        if (request.method === "GET" && parts[3] === "report") {
          const report = exportReport(repo, caseId);
          response.setHeader("etag", `\"sha256:${report.sha256}\"`);
          send(response, 200, report);
          return;
        }
      }
      send(response, 404, { error: "not found" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unexpected error";
      send(response, error instanceof RangeError ? 416 : 400, {
        error: message,
      });
    }
  });
}
