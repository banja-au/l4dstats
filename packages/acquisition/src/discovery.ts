import { AcquisitionError } from "./errors.js";

export interface DiscoveryOptions {
  allowedHosts: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof globalThis.fetch;
}

const hrefPattern = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;

/** Streams an Apache-style index and yields same-host .zip links without buffering the page. */
export async function* discoverZipUrls(
  index: URL,
  options: DiscoveryOptions,
): AsyncGenerator<URL> {
  assertAllowedHttps(index, options.allowedHosts);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const operationSignal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const response = await boundedFetch(index, {
    ...options,
    signal: operationSignal,
  });
  if (!response.body)
    throw new AcquisitionError("HTTP", "index response has no body");
  const decoder = new TextDecoder();
  const seen = new Set<string>();
  let carry = "";
  let consumed = 0;
  try {
    for await (const chunk of response.body) {
      consumed += chunk.byteLength;
      if (consumed > (options.maxBytes ?? 8 * 1024 * 1024)) {
        throw new AcquisitionError(
          "DOWNLOAD_LIMIT",
          "directory index exceeds byte limit",
        );
      }
      carry += decoder.decode(chunk, { stream: true });
      // Never cut through a tag that may be completed by the next chunk.
      const candidate = Math.max(0, carry.length - 4096);
      const openTag = carry.lastIndexOf("<", candidate);
      // A malformed tag cannot force unbounded retention; anchors over 4 KiB are ignored.
      const scanThrough =
        openTag >= 0 && candidate - openTag < 4096 ? openTag : candidate;
      const searchable = carry.slice(0, scanThrough);
      yield* links(searchable, index, options.allowedHosts, seen);
      carry = carry.slice(scanThrough);
    }
  } catch (error) {
    if (error instanceof AcquisitionError) throw error;
    if (operationSignal.aborted)
      throw new AcquisitionError(
        options.signal?.aborted ? "ABORTED" : "TIMEOUT",
        "discovery aborted",
        { cause: error },
      );
    throw error;
  }
  carry += decoder.decode();
  yield* links(carry, index, options.allowedHosts, seen);
}

function* links(
  html: string,
  base: URL,
  hosts: readonly string[],
  seen: Set<string>,
): Generator<URL> {
  hrefPattern.lastIndex = 0;
  for (const match of html.matchAll(hrefPattern)) {
    if (!match[1]) continue;
    let candidate: URL;
    try {
      candidate = new URL(match[1], base);
    } catch {
      continue;
    }
    if (!candidate.pathname.toLowerCase().endsWith(".zip")) continue;
    try {
      assertAllowedHttps(candidate, hosts);
    } catch {
      continue;
    }
    candidate.hash = "";
    if (!seen.has(candidate.href)) {
      seen.add(candidate.href);
      yield candidate;
    }
  }
}

export function assertAllowedHttps(
  url: URL,
  allowedHosts: readonly string[],
): void {
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowedHosts.includes(url.hostname)
  ) {
    throw new AcquisitionError(
      "ALLOWLIST",
      `URL is not allowlisted HTTPS: ${url.origin}`,
    );
  }
}

export async function boundedFetch(
  url: URL,
  options: DiscoveryOptions,
): Promise<Response> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    assertAllowedHttps(current, options.allowedHosts);
    let response: Response;
    try {
      response = await fetcher(current, { redirect: "manual", signal });
    } catch (error) {
      if (signal.aborted)
        throw new AcquisitionError(
          options.signal?.aborted ? "ABORTED" : "TIMEOUT",
          "fetch aborted",
          { cause: error },
        );
      throw error;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new AcquisitionError("HTTP", "redirect is missing Location");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok)
      throw new AcquisitionError("HTTP", `HTTP ${response.status}`);
    return response;
  }
  throw new AcquisitionError("REDIRECT_LIMIT", "too many redirects");
}
