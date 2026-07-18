import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { WorkbenchRepository } from "../packages/storage/dist/index.js";

const execute = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fileHash(path) {
  return sha256(await readFile(path));
}

async function validateArchive(archive, expectedHash) {
  if ((await fileHash(archive)) !== expectedHash)
    throw new Error("backup checksum mismatch");
  const { stdout: names } = await execute("tar", ["-tzf", archive]);
  for (const name of names.split("\n").filter(Boolean)) {
    if (name.startsWith("/") || name.split("/").includes(".."))
      throw new Error(`unsafe backup member: ${name}`);
  }
  const { stdout: entries } = await execute("tar", ["-tvzf", archive]);
  for (const entry of entries.split("\n").filter(Boolean))
    if (!"-d".includes(entry[0] ?? ""))
      throw new Error(`unsupported backup entry: ${entry}`);
}

const root = await mkdtemp(join(tmpdir(), "l4dstats-restore-drill-"));
const source = join(root, "source");
const restored = join(root, "restored");
const archive = join(root, "workbench.tar.gz");
const database = join(source, "workbench.sqlite");
const artifact = join(source, "artifacts", "fixture-analysis.json");
const nativeBuildSha256 = "b".repeat(64);

try {
  await mkdir(join(source, "artifacts"), { recursive: true });
  const repository = new WorkbenchRepository(database);
  const job = repository.enqueue(
    {
      kind: "local",
      path: "/data/inbox/recovery-fixture.dem",
      sha256: "a".repeat(64),
      bytes: 4096,
    },
    "recovery-drill-job",
  );
  const parser = {
    engine: "rust-native",
    coreVersion: "0.1.0",
    bindingVersion: "0.1.0",
    bindingApiVersion: 2,
    configVersion: 1,
    wireVersion: 1,
    parserConfigId: "source1-l4d2-2100-v1",
    buildSha256: nativeBuildSha256,
  };
  const engineResult = {
    schemaVersion: 1,
    demo: {
      sha256: "a".repeat(64),
      mapName: "c8m1_apartment",
      bytes: 4096,
      parser,
    },
    cases: [],
  };
  repository.recordJobAnalysis({
    jobId: job.id,
    demoSha256: "a".repeat(64),
    sourceManifest: { kind: "local", sha256: "a".repeat(64) },
    engineResult,
    engineResultSha256: sha256(JSON.stringify(engineResult)),
  });
  repository.close();
  await writeFile(
    artifact,
    `${JSON.stringify({
      schemaVersion: 1,
      jobId: job.id,
      map: "c8m1_apartment",
      demo: {
        parser,
      },
    })}\n`,
    { mode: 0o600 },
  );
  const sourceHashes = {
    database: await fileHash(database),
    artifact: await fileHash(artifact),
  };

  await execute("tar", ["-C", source, "-czf", archive, "."]);
  const archiveHash = await fileHash(archive);
  await validateArchive(archive, archiveHash);

  await mkdir(restored, { recursive: true });
  await execute("tar", [
    "--no-same-owner",
    "--no-same-permissions",
    "-C",
    restored,
    "-xzf",
    archive,
  ]);
  const restoredHashes = {
    database: await fileHash(join(restored, "workbench.sqlite")),
    artifact: await fileHash(
      join(restored, "artifacts", "fixture-analysis.json"),
    ),
  };
  if (JSON.stringify(restoredHashes) !== JSON.stringify(sourceHashes))
    throw new Error("restored database or artifact hash changed");
  const restoredArtifact = JSON.parse(
    await readFile(
      join(restored, "artifacts", "fixture-analysis.json"),
      "utf8",
    ),
  );
  if (
    restoredArtifact.demo?.parser?.engine !== "rust-native" ||
    restoredArtifact.demo?.parser?.buildSha256 !== nativeBuildSha256 ||
    restoredArtifact.demo?.parser?.bindingApiVersion !== 2 ||
    restoredArtifact.demo?.parser?.configVersion !== 1 ||
    restoredArtifact.demo?.parser?.wireVersion !== 1
  )
    throw new Error("restored analysis lost native parser attestation");

  const restoredRepository = new WorkbenchRepository(
    join(restored, "workbench.sqlite"),
  );
  const restoredJob = restoredRepository.getJob(job.id);
  const restoredAnalysis = restoredRepository.getJobAnalysis(job.id);
  const ready = restoredRepository.isReady();
  restoredRepository.close();
  if (!ready || restoredJob?.idempotencyKey !== "recovery-drill-job")
    throw new Error("restored repository lost durable state");
  if (
    restoredAnalysis?.engineResult?.demo?.parser?.engine !== "rust-native" ||
    restoredAnalysis?.engineResult?.demo?.parser?.buildSha256 !==
      nativeBuildSha256
  )
    throw new Error("restored database lost native parser attestation");

  const corrupted = Buffer.from(await readFile(archive));
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  const corruptedArchive = join(root, "corrupted.tar.gz");
  await writeFile(corruptedArchive, corrupted);
  let rejected = false;
  try {
    await validateArchive(corruptedArchive, archiveHash);
  } catch (error) {
    rejected =
      error instanceof Error && error.message === "backup checksum mismatch";
  }
  if (!rejected) throw new Error("corrupted backup was not rejected");

  const restoredFiles = await readdir(join(restored, "artifacts"));
  if (restoredFiles.length !== 1)
    throw new Error("restore produced an unexpected artifact set");
  process.stdout.write(
    `Backup checksum, safe archive, SQLite recovery and artifact hashes passed for job ${job.id}.\n`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
