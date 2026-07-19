declare class Buffer extends Uint8Array {
  static alloc(size: number, fill?: number): Buffer;
  static concat(parts: readonly Uint8Array[]): Buffer;
  static from(
    value: string | ArrayBuffer | ArrayLike<number> | Uint8Array,
    encoding?: string,
  ): Buffer;
  readUInt16LE(offset: number): number;
  readUInt32LE(offset: number): number;
  writeUInt16LE(value: number, offset?: number): number;
  writeUInt32LE(value: number, offset?: number): number;
  subarray(start?: number, end?: number): Buffer;
  toString(encoding?: string): string;
}
declare module "node:crypto" {
  export function createHash(name: string): {
    update(data: Uint8Array): any;
    digest(encoding: "hex"): string;
  };
  export function randomUUID(): string;
}
declare module "node:fs" {
  export const constants: { COPYFILE_EXCL: number };
}
declare module "node:fs/promises" {
  export function copyFile(
    source: string,
    target: string,
    flags?: number,
  ): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<unknown>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function open(
    path: string,
    flags: string,
    mode?: number,
  ): Promise<{
    write(data: Uint8Array): Promise<unknown>;
    close(): Promise<void>;
  }>;
  export function readFile(path: string): Promise<Buffer>;
  export function readdir(path: string): Promise<string[]>;
  export function unlink(path: string): Promise<void>;
}
declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}
declare module "node:os" {
  export function tmpdir(): string;
}
declare module "node:zlib" {
  export function deflateRawSync(data: Uint8Array): Buffer;
  export function inflateRawSync(
    data: Uint8Array,
    options?: { maxOutputLength?: number },
  ): Buffer;
}
