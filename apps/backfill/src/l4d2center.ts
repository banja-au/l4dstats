import type { DiscoveredDemo, SourceAdapter } from "./types.js";

const LIST_URL = "https://demosrv.l4d2center.com/api/list?search=GAME&";
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const SOURCE_ID = "l4d2center";
const NAME = /^([A-Za-z0-9]+)_.+\.dem\.xz$/;

interface ListResponse {
  success?: unknown;
  demos?: unknown;
}

async function boundedBody(
  response: Response,
  log: (message: string) => void,
): Promise<Uint8Array> {
  if (!response.body) throw new Error("L4D2Center list has no response body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_LIST_BYTES)
      throw new Error("L4D2Center list exceeds byte limit");
    chunks.push(chunk);
    if (
      total === chunk.byteLength ||
      total % (5 * 1024 * 1024) < chunk.byteLength
    )
      log(
        `source listing download: ${(total / 1024 / 1024).toFixed(1)} MiB received`,
      );
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseEntry(value: unknown): DiscoveredDemo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.name !== "string" ||
    !NAME.test(row.name) ||
    typeof row.date !== "number" ||
    !Number.isSafeInteger(row.date) ||
    row.date < 1 ||
    typeof row.download !== "string"
  )
    return undefined;
  let download: URL;
  try {
    download = new URL(row.download);
  } catch {
    return undefined;
  }
  if (
    download.protocol !== "https:" ||
    download.hostname !== "demosdl.l4d2center.com" ||
    download.username ||
    download.password ||
    download.search ||
    download.hash ||
    download.pathname.split("/").at(-1) !== row.name
  )
    return undefined;
  const publishedAt = new Date(row.date * 1_000);
  if (!Number.isFinite(publishedAt.getTime())) return undefined;
  const sizeMb = row.size_mb;
  const gameHint = NAME.exec(row.name)?.[1] ?? null;
  const withoutContainer = row.name.replace(/\.dem\.xz$/i, "");
  const withoutTimestamp = withoutContainer.replace(/_\d+$/, "");
  const mapKey = gameHint
    ? withoutTimestamp.slice(gameHint.length + 1)
    : withoutTimestamp;
  const chapterMatch = mapKey.match(/(?:^|_)c\d+m(\d+)(?:_|$)/i);
  const chapterHint = chapterMatch?.[1] ? Number(chapterMatch[1]) : null;
  const declaredBytes =
    typeof sizeMb === "number" && Number.isFinite(sizeMb) && sizeMb > 0
      ? Math.round(sizeMb * 1024 * 1024)
      : null;
  return {
    sourceId: SOURCE_ID,
    sourceItemKey: row.name,
    publishedAt: publishedAt.toISOString(),
    downloadUrl: download.href,
    filename: row.name,
    declaredBytes,
    gameHint,
    metadata: { date: row.date, sizeMb: sizeMb ?? null, mapKey, chapterHint },
  };
}

export class L4D2CenterSource implements SourceAdapter {
  public readonly id = SOURCE_ID;

  public constructor(
    private readonly fetcher = globalThis.fetch,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  public async discover(signal?: AbortSignal): Promise<DiscoveredDemo[]> {
    this.log(`requesting source listing: ${LIST_URL}`);
    const timeout = AbortSignal.timeout(30_000);
    const response = await this.fetcher(LIST_URL, {
      headers: { accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok)
      throw new Error(`L4D2Center list returned ${response.status}`);
    this.log(
      `source listing response: HTTP ${response.status}, content-length=${response.headers.get("content-length") ?? "unknown"}`,
    );
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_LIST_BYTES)
      throw new Error("L4D2Center list exceeds byte limit");
    const bytes = await boundedBody(response, this.log);
    this.log(
      `source listing downloaded: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MiB; parsing JSON`,
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as ListResponse;
    if (payload.success !== true || !Array.isArray(payload.demos))
      throw new Error("L4D2Center returned an invalid list response");
    const parsed = payload.demos
      .map(parseEntry)
      .filter((item) => item !== undefined);
    if (parsed.length !== payload.demos.length)
      throw new Error(
        `L4D2Center list contained ${payload.demos.length - parsed.length} invalid entries`,
      );
    this.log(`source listing validated: ${parsed.length} demos`);
    return parsed;
  }
}
