import { randomUUID } from "node:crypto";
import { lstat, rename, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  ContentAddressedStore,
  WorkbenchRepository,
  type RetentionPurgeResult,
} from "@l4dstats/storage";

const [mode, daysValue, confirmation, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  (mode !== "preview" && mode !== "purge") ||
  (mode === "purge" && confirmation !== "--confirm-purge") ||
  (mode === "preview" && confirmation !== undefined)
) {
  process.stderr.write(
    "Usage: retention preview <days> | retention purge <days> --confirm-purge\n",
  );
  process.exitCode = 64;
} else {
  const days = Number(daysValue);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3_650)
    throw new RangeError("retention days must be an integer from 1 to 3650");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const repo = new WorkbenchRepository(
    process.env.L4DSTATS_DB ?? "data/workbench.sqlite",
  );
  try {
    const preview = repo.purgeTerminalJobsBefore(cutoff, true);
    if (mode === "preview") {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    } else {
      const uploadRoot = resolve(
        process.env.L4DSTATS_UPLOAD_ROOT ?? "data/uploads",
      );
      const artifactStore = new ContentAddressedStore(
        resolve(process.env.L4DSTATS_ARTIFACT_ROOT ?? "/var/lib/l4dstats"),
      );
      const targets = [
        ...preview.localPaths
          .map((path) => resolve(path))
          .filter((path) => isInside(uploadRoot, path)),
        ...preview.artifactHashes.map((hash) => artifactStore.path(hash)),
      ];
      const staged: Array<{ source: string; pending: string }> = [];
      let metadataPurged = false;
      try {
        for (const source of [...new Set(targets)]) {
          let metadata;
          try {
            metadata = await lstat(source);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          if (!metadata.isFile() || metadata.isSymbolicLink())
            throw new Error(
              `retention target is not a regular file: ${source}`,
            );
          const pending = `${source}.retention-${randomUUID()}.pending`;
          await rename(source, pending);
          staged.push({ source, pending });
        }
        const purged = repo.purgeTerminalJobsBefore(cutoff, false);
        metadataPurged = true;
        assertSamePlan(preview, purged);
        for (const { pending } of staged) await unlink(pending);
        process.stdout.write(`${JSON.stringify(purged, null, 2)}\n`);
      } catch (error) {
        if (!metadataPurged)
          for (const { source, pending } of staged.reverse())
            await rename(pending, source).catch(() => undefined);
        throw error;
      }
    }
  } finally {
    repo.close();
  }
}

function isInside(root: string, target: string) {
  const path = relative(root, target);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function assertSamePlan(
  preview: RetentionPurgeResult,
  purged: RetentionPurgeResult,
) {
  const normalized = (value: RetentionPurgeResult) => ({
    jobs: value.jobs,
    cases: value.cases,
    games: value.games,
    localPaths: value.localPaths,
    artifactHashes: value.artifactHashes,
  });
  if (
    JSON.stringify(normalized(preview)) !== JSON.stringify(normalized(purged))
  )
    throw new Error("retention plan changed during purge");
}
