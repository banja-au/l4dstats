import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class ContentAddressedStore {
  public constructor(private readonly root: string) {}

  public path(hash: string): string {
    if (!SHA256.test(hash)) throw new Error("invalid SHA-256");
    return join(this.root, "sha256", hash.slice(0, 2), hash);
  }

  public async put(
    data: Uint8Array,
  ): Promise<{ sha256: string; bytes: number }> {
    const hash = sha256(data);
    const target = this.path(hash);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      const file = await open(temporary, "wx");
      try {
        await file.writeFile(data);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, target).catch(async (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return { sha256: hash, bytes: data.byteLength };
  }

  public async read(
    hash: string,
    range?: { start: number; endExclusive: number },
  ): Promise<Uint8Array> {
    const target = this.path(hash);
    if (!range) return readFile(target);
    const info = await stat(target);
    if (
      range.start < 0 ||
      range.endExclusive <= range.start ||
      range.endExclusive > info.size
    ) {
      throw new RangeError("artifact range is outside the stored object");
    }
    const length = range.endExclusive - range.start;
    const output = new Uint8Array(length);
    const file = await open(target, "r");
    try {
      await file.read(output, 0, length, range.start);
    } finally {
      await file.close();
    }
    return output;
  }

  public async delete(hash: string): Promise<boolean> {
    const target = this.path(hash);
    try {
      await unlink(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
