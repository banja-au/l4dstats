import type { HostedObjectStore, ObjectMetadata } from "./hosted.js";

interface R2ObjectLike {
  key: string;
  size: number;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
}

interface R2BodyLike extends R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(
    key: string,
    options?: { range: { offset: number; length: number } },
  ): Promise<R2BodyLike | R2ObjectLike | null>;
  put(
    key: string,
    value: Uint8Array,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { contentType: string };
    },
  ): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

const SHA256 = /^[a-f0-9]{64}$/;

function metadata(value: R2ObjectLike): ObjectMetadata {
  const sha256 = value.customMetadata?.sha256;
  if (!sha256 || !SHA256.test(sha256))
    throw new Error(`R2 object ${value.key} has no valid SHA-256 metadata`);
  return {
    key: value.key,
    bytes: value.size,
    sha256,
    contentType: value.httpMetadata?.contentType ?? "application/octet-stream",
  };
}

function body(value: R2BodyLike | R2ObjectLike): R2BodyLike {
  if (!("arrayBuffer" in value))
    throw new Error("R2 object body is unavailable");
  return value;
}

export class R2ObjectStore implements HostedObjectStore {
  public constructor(private readonly bucket: R2BucketLike) {}

  public async head(key: string): Promise<ObjectMetadata | undefined> {
    const value = await this.bucket.head(key);
    return value ? metadata(value) : undefined;
  }

  public async get(key: string): Promise<Uint8Array> {
    const value = await this.bucket.get(key);
    if (!value) throw new Error(`R2 object is unavailable: ${key}`);
    return new Uint8Array(await body(value).arrayBuffer());
  }

  public async getRange(
    key: string,
    start: number,
    endExclusive: number,
  ): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(endExclusive) ||
      start < 0 ||
      endExclusive <= start
    )
      throw new RangeError("R2 range is invalid");
    const value = await this.bucket.get(key, {
      range: { offset: start, length: endExclusive - start },
    });
    if (!value) throw new Error(`R2 object is unavailable: ${key}`);
    const bytes = new Uint8Array(await body(value).arrayBuffer());
    if (bytes.byteLength !== endExclusive - start)
      throw new Error("R2 returned an incomplete object range");
    return bytes;
  }

  public async put(
    key: string,
    bytes: Uint8Array,
    input: { sha256: string; contentType: string },
  ): Promise<ObjectMetadata> {
    if (!SHA256.test(input.sha256))
      throw new Error("object SHA-256 is invalid");
    const value = await this.bucket.put(key, bytes, {
      customMetadata: { sha256: input.sha256 },
      httpMetadata: { contentType: input.contentType },
    });
    if (!value) throw new Error(`R2 did not confirm object write: ${key}`);
    const stored = metadata(value);
    if (stored.bytes !== bytes.byteLength || stored.sha256 !== input.sha256)
      throw new Error(
        "R2 object metadata does not match the uploaded artifact",
      );
    return stored;
  }

  public async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
    if (await this.head(key))
      throw new Error(`R2 object deletion failed: ${key}`);
  }
}
